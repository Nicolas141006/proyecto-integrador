require("dotenv").config();
const http = require("http");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "db_proy_integrador",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Sesiones temporales en memoria.
const sesiones = new Map();
const DURACION_SESION = 2 * 60 * 60 * 1000;

// Carpeta física de imágenes para cada categoría válida de producto.
const CARPETA_POR_CATEGORIA = {
    "tortas-clasicas": "tortas",
    "postres": "postres",
    "bocaditos": "bocaditos",
    "kekes-caseros": "kekes"
};

const TAMANO_MAXIMO_IMAGEN = 5 * 1024 * 1024;

// Clasificaciones válidas para un diseño de la galería.
const CATEGORIAS_GALERIA = ["cumpleanos", "infantiles", "eventos", "elegantes"];

// Respaldo si la fila de configuración no existiera todavía.
const ANTICIPACION_MINIMA_RESPALDO = 4;

// Único punto donde se lee la anticipación mínima real (nunca se confía en
// un valor enviado por el navegador para validar la fecha de recojo).
async function obtenerAnticipacionMinimaDias() {
    const [[fila]] = await pool.query(
            "SELECT condiciones_pedido FROM configuracion WHERE id = 1"
            );

    const dias = Number(fila?.condiciones_pedido?.anticipacionMinimaDias);

    return Number.isInteger(dias) && dias >= 0 ? dias : ANTICIPACION_MINIMA_RESPALDO;
}

// Validar fecha (AAAA-MM-DD) y hora (HH:MM) de recojo propuestas o editadas,
// respetando la anticipación mínima configurada. Se usa tanto al crear el
// pedido desde el carrito como al editarlo desde el panel.
async function validarFechaHoraRecojo(fechaTexto, horaTexto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaTexto || ""))) {
        throw new Error("Selecciona una fecha de recojo válida.");
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(horaTexto || ""))) {
        throw new Error("Selecciona una hora de recojo válida.");
    }

    const fecha = new Date(`${fechaTexto}T00:00:00`);

    if (Number.isNaN(fecha.getTime())) {
        throw new Error("La fecha de recojo no es válida.");
    }

    const anticipacionMinimaDias = await obtenerAnticipacionMinimaDias();

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const minimaPermitida = new Date(hoy);
    minimaPermitida.setDate(minimaPermitida.getDate() + anticipacionMinimaDias);

    if (fecha < minimaPermitida) {
        throw new Error(
                `La fecha de recojo debe tener al menos ${anticipacionMinimaDias} ` +
                `día(s) de anticipación.`
                );
    }

    return {fecha: fechaTexto, hora: horaTexto};
}

// Validar fecha/hora ya acordadas para un pedido registrado manualmente por
// la dueña (WhatsApp, llamada o presencial). A diferencia de
// validarFechaHoraRecojo, aquí NO se exige la anticipación mínima: el trato
// ya está cerrado con el cliente, puede ser para el mismo día.
async function validarFechaHoraAcordada(fechaTexto, horaTexto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaTexto || ""))) {
        throw new Error("La fecha acordada no es válida.");
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(horaTexto || ""))) {
        throw new Error("La hora acordada no es válida.");
    }

    if (Number.isNaN(new Date(`${fechaTexto}T00:00:00`).getTime())) {
        throw new Error("La fecha acordada no es válida.");
    }

    return {fecha: fechaTexto, hora: horaTexto};
}

// Validar y resolver los ítems de un pedido (por slug o id de producto, con
// cantidad y presentación opcional) contra la base de datos real: el precio
// nunca se confía del navegador ni del formulario del panel. La usan tanto
// el pedido web (POST /api/pedidos) como el pedido manual del panel, para
// que ambos calculen exactamente igual y no haya dos copias de esta lógica.
async function resolverDetallesPedido(conexion, items) {
    const detalles = [];
    let subtotal = 0;

    for (const item of items) {
        const identificador = String(
                item.productoId ?? item.slug ?? ""
                ).trim();
        const cantidad = Number(item.cantidad);

        if (
                !identificador ||
                !Number.isSafeInteger(cantidad) ||
                cantidad < 1 ||
                cantidad > 99
                ) {
            throw new Error("Producto o cantidad no válidos.");
        }

        const [productos] = await conexion.execute(
                `SELECT id, nombre, slug, precio, disponible,
                        presentaciones, unidad_venta
                 FROM productos
                 WHERE (id = ? OR slug = ?) AND disponible = TRUE
                 LIMIT 1`,
                [identificador, identificador]
                );

        if (productos.length === 0) {
            throw new Error(
                    "Uno de los productos ya no está disponible."
                    );
        }

        const producto = productos[0];
        const presentacion = String(item.presentacion || "").trim();

        // El precio nunca se toma del navegador: si hay una presentación,
        // su precio se busca en la columna "presentaciones" ya leída de
        // MySQL en esta misma consulta.
        let precio = Number(producto.precio);

        if (presentacion) {
            const mapaPresentaciones =
                    producto.presentaciones &&
                    typeof producto.presentaciones === "object" &&
                    !Array.isArray(producto.presentaciones)
                    ? producto.presentaciones
                    : {};

            const precioPresentacion = mapaPresentaciones[presentacion];

            if (
                    precioPresentacion === undefined ||
                    !Number.isFinite(Number(precioPresentacion)) ||
                    Number(precioPresentacion) < 0
                    ) {
                throw new Error(
                        "La presentación seleccionada no es válida para este producto."
                        );
            }

            precio = Number(precioPresentacion);
        }

        if (!Number.isFinite(precio) || precio < 0) {
            throw new Error(
                    "No se pudo verificar el precio de un producto."
                    );
        }

        const importe = Math.round(precio * cantidad * 100) / 100;

        subtotal += importe;

        detalles.push({
            productoId: producto.id,
            nombre: producto.nombre,
            presentacion,
            cantidad,
            precio,
            subtotal: importe
        });
    }

    subtotal = Math.round(subtotal * 100) / 100;

    return {detalles, subtotal};
}

// Detectar el formato real de una imagen por su firma binaria (magic bytes),
// nunca por la extensión del archivo que mande el navegador.
function detectarTipoImagen(buffer) {
    if (
            buffer.length >= 8 &&
            buffer[0] === 0x89 && buffer[1] === 0x50 &&
            buffer[2] === 0x4e && buffer[3] === 0x47 &&
            buffer[4] === 0x0d && buffer[5] === 0x0a &&
            buffer[6] === 0x1a && buffer[7] === 0x0a
            ) {
        return "png";
    }

    if (
            buffer.length >= 3 &&
            buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
            ) {
        return "jpg";
    }

    if (
            buffer.length >= 12 &&
            buffer.toString("ascii", 0, 4) === "RIFF" &&
            buffer.toString("ascii", 8, 12) === "WEBP"
            ) {
        return "webp";
    }

    return null;
}

// Generar un slug a partir del nombre del producto.
function generarSlug(nombre) {
    return String(nombre)
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "producto";
}

// Garantizar que el slug generado no choque con uno existente.
async function generarSlugUnico(conexion, nombre) {
    const base = generarSlug(nombre);
    let slug = base;
    let sufijo = 2;

    while (true) {
        const [filas] = await conexion.execute(
                "SELECT id FROM productos WHERE slug = ? LIMIT 1",
                [slug]
                );

        if (filas.length === 0) {
            return slug;
        }

        slug = `${base}-${sufijo}`;
        sufijo++;
    }
}

// Resolver de forma segura una ruta dentro de fotos/<carpeta>/, igual que
// enviarArchivo hace para los archivos públicos, evitando path traversal.
function rutaSeguraFoto(carpeta, nombreArchivo) {
    const base = path.resolve(ROOT, "fotos", carpeta);
    const archivo = path.resolve(base, nombreArchivo);

    if (!archivo.startsWith(base + path.sep)) {
        throw new Error("Ruta de imagen no válida.");
    }

    return archivo;
}

// Leer un cuerpo multipart/form-data (campos de texto + un archivo) sin
// dependencias externas. Solo se usa para los endpoints de productos.
function leerCuerpoMultipart(req, limiteBytes) {
    return new Promise((resolve, reject) => {
        const tipoContenido = req.headers["content-type"] || "";
        const coincidenciaBoundary = tipoContenido.match(
                /boundary=(?:"([^"]+)"|([^;]+))/i
                );

        if (!coincidenciaBoundary) {
            reject(new Error("El formato de los datos no es válido."));
            return;
        }

        const boundary =
                "--" + (coincidenciaBoundary[1] || coincidenciaBoundary[2]).trim();

        const fragmentos = [];
        let tamano = 0;

        req.on("data", (fragmento) => {
            tamano += fragmento.length;

            if (tamano > limiteBytes) {
                reject(new Error(
                        "La imagen supera el tamaño máximo permitido (5 MB)."
                        ));
                req.destroy();
                return;
            }

            fragmentos.push(fragmento);
        });

        req.on("end", () => {
            try {
                resolve(parsearPartesMultipart(Buffer.concat(fragmentos), boundary));
            } catch {
                reject(new Error("El formato de los datos no es válido."));
            }
        });

        req.on("error", reject);
    });
}

function parsearPartesMultipart(buffer, boundary) {
    const inicioBoundary = Buffer.from(boundary);
    const delimitador = Buffer.from("\r\n" + boundary);

    const campos = {};
    const archivos = {};

    let posicion = buffer.indexOf(inicioBoundary);

    if (posicion === -1) {
        return {campos, archivos};
    }

    posicion += inicioBoundary.length;

    while (true) {
        if (buffer.slice(posicion, posicion + 2).toString("ascii") === "--") {
            break;
        }

        posicion += 2; // Saltar el \r\n posterior al boundary.

        const finCabeceras = buffer.indexOf("\r\n\r\n", posicion);

        if (finCabeceras === -1) {
            break;
        }

        const cabeceras = buffer.slice(posicion, finCabeceras).toString("utf8");
        const inicioContenido = finCabeceras + 4;
        const siguienteBoundary = buffer.indexOf(delimitador, inicioContenido);

        if (siguienteBoundary === -1) {
            break;
        }

        const contenido = buffer.slice(inicioContenido, siguienteBoundary);
        const nombreMatch = cabeceras.match(/name="([^"]+)"/i);
        const archivoMatch = cabeceras.match(/filename="([^"]*)"/i);

        if (nombreMatch) {
            const nombreCampo = nombreMatch[1];

            if (archivoMatch) {
                if (archivoMatch[1]) {
                    archivos[nombreCampo] = {
                        nombreOriginal: archivoMatch[1],
                        datos: contenido
                    };
                }
            } else {
                campos[nombreCampo] = contenido.toString("utf8");
            }
        }

        posicion = siguienteBoundary + delimitador.length;
    }

    return {campos, archivos};
}

// Guardar una imagen de producto de forma segura: primero a un archivo
// temporal; solo se confirma (renombra al nombre final) si el cambio en
// MySQL tiene éxito, evitando archivos huérfanos ante un fallo.
async function guardarImagenProducto(carpeta, slug, extension, buffer) {
    const carpetaAbsoluta = path.resolve(ROOT, "fotos", carpeta);
    await fs.promises.mkdir(carpetaAbsoluta, {recursive: true});

    const nombreTemporal =
            `.tmp-${crypto.randomBytes(8).toString("hex")}-${slug}.${extension}`;

    const rutaTemporal = rutaSeguraFoto(carpeta, nombreTemporal);
    const rutaFinal = rutaSeguraFoto(carpeta, `${slug}.${extension}`);

    await fs.promises.writeFile(rutaTemporal, buffer);

    return {
        rutaRelativa: `${carpeta}/${slug}.${extension}`,
        async confirmar() {
            await fs.promises.rename(rutaTemporal, rutaFinal);
        },
        async descartar() {
            await fs.promises.unlink(rutaTemporal).catch(() => {});
        }
    };
}

// Interpretar un campo de texto del formulario como JSON opcional.
// undefined = el campo no llegó (en edición significa "no tocar");
// null = se envió vacío (significa "borrar"); objeto = valor nuevo.
function parsearCampoJSON(texto) {
    if (texto === undefined) {
        return undefined;
    }

    const limpio = String(texto).trim();

    if (!limpio || limpio === "null") {
        return null;
    }

    try {
        return JSON.parse(limpio);
    } catch {
        throw new Error("El formato de los datos no es válido.");
    }
}

// Validar y normalizar el mapa libre clave→valor de "detalles".
function validarDetallesProducto(valor) {
    if (valor === null) {
        return null;
    }

    if (typeof valor !== "object" || Array.isArray(valor)) {
        throw new Error("El formato de las características no es válido.");
    }

    const entradas = Object.entries(valor);

    if (entradas.length === 0) {
        return null;
    }

    if (entradas.length > 20) {
        throw new Error("No se permiten más de 20 características.");
    }

    const resultado = {};

    for (const [clave, dato] of entradas) {
        const claveLimpia = String(clave).trim();
        const datoLimpio = String(dato ?? "").trim();

        if (!claveLimpia || claveLimpia.length > 60) {
            throw new Error("Una de las características tiene una clave no válida.");
        }

        if (datoLimpio.length > 300) {
            throw new Error("Uno de los valores de las características es demasiado largo.");
        }

        resultado[claveLimpia] = datoLimpio;
    }

    return resultado;
}

// Validar y normalizar el mapa etiqueta→precio de "presentaciones".
function validarPresentacionesProducto(valor) {
    if (valor === null) {
        return null;
    }

    if (typeof valor !== "object" || Array.isArray(valor)) {
        throw new Error("El formato de las presentaciones no es válido.");
    }

    const entradas = Object.entries(valor);

    if (entradas.length === 0) {
        return null;
    }

    if (entradas.length > 20) {
        throw new Error("No se permiten más de 20 presentaciones.");
    }

    const resultado = {};

    for (const [etiqueta, precio] of entradas) {
        const etiquetaLimpia = String(etiqueta).trim();
        const precioNumero = Number(precio);

        if (!etiquetaLimpia || etiquetaLimpia.length > 60) {
            throw new Error("Una de las presentaciones tiene una etiqueta no válida.");
        }

        if (!Number.isFinite(precioNumero) || precioNumero < 0) {
            throw new Error("Uno de los precios de presentación no es válido.");
        }

        resultado[etiquetaLimpia] = precioNumero;
    }

    return resultado;
}

// Validación de las secciones de configuración del negocio. Cada una se
// valida por separado porque cada formulario del panel se guarda sola.
// Métodos de pago (se coordinan por WhatsApp) y condiciones de pedido (viven
// fuera de este módulo) no tienen formulario ni validación aquí.
function validarDatosNegocio(valor) {
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
        throw new Error("El formato de los datos del negocio no es válido.");
    }

    const nombre = String(valor.nombre ?? "").trim();
    const whatsapp = String(valor.whatsapp ?? "").trim();
    const telefono = String(valor.telefono ?? "").trim();
    const direccion = String(valor.direccion ?? "").trim();
    const mapsUrl = String(valor.mapsUrl ?? "").trim();

    const redes = valor.redesSociales &&
            typeof valor.redesSociales === "object" &&
            !Array.isArray(valor.redesSociales)
            ? valor.redesSociales
            : {};

    if (nombre.length < 2 || nombre.length > 150) {
        throw new Error("El nombre de la pastelería debe tener entre 2 y 150 caracteres.");
    }

    if (whatsapp && !/^[0-9]{9,15}$/.test(whatsapp)) {
        throw new Error("El número de WhatsApp no es válido.");
    }

    if (telefono && !/^[0-9]{6,15}$/.test(telefono)) {
        throw new Error("El número de contacto no es válido.");
    }

    if (direccion.length > 255) {
        throw new Error("La dirección es demasiado larga.");
    }

    if (mapsUrl.length > 500) {
        throw new Error("El enlace de Google Maps es demasiado largo.");
    }

    if (mapsUrl && !/^https?:\/\//i.test(mapsUrl)) {
        throw new Error("El enlace de Google Maps debe comenzar con http:// o https://.");
    }

    const redesSociales = {};

    for (const clave of ["facebook", "instagram", "tiktok"]) {
        const dato = String(redes[clave] ?? "").trim();

        if (dato.length > 255) {
            throw new Error("Uno de los enlaces de redes sociales es demasiado largo.");
        }

        redesSociales[clave] = dato;
    }

    return {nombre, whatsapp, telefono, direccion, mapsUrl, redesSociales};
}

const DIAS_VALIDOS = [
    "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"
];

function validarHorarios(valor) {
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
        throw new Error("El formato de los horarios no es válido.");
    }

    const dias = Array.isArray(valor.dias) ? valor.dias.map(String) : [];

    if (dias.some((dia) => !DIAS_VALIDOS.includes(dia))) {
        throw new Error("Uno de los días seleccionados no es válido.");
    }

    const apertura = String(valor.apertura ?? "").trim();
    const cierre = String(valor.cierre ?? "").trim();
    const horaValida = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (!horaValida.test(apertura) || !horaValida.test(cierre)) {
        throw new Error("La hora de apertura o de cierre no es válida.");
    }

    return {dias, apertura, cierre};
}

// Validar un adicional cotizado por WhatsApp (nombre, descripción, precio).
function validarAdicionalPedido(valor) {
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
        throw new Error("El formato del adicional no es válido.");
    }

    const nombre = String(valor.nombre ?? "").trim();
    const descripcion = String(valor.descripcion ?? "").trim();
    const precio = Number(valor.precio);

    if (nombre.length < 2 || nombre.length > 150) {
        throw new Error("El nombre del adicional debe tener entre 2 y 150 caracteres.");
    }

    if (descripcion.length > 500) {
        throw new Error("La descripción del adicional es demasiado larga.");
    }

    if (!Number.isFinite(precio) || precio <= 0 || precio > 100000) {
        throw new Error("Ingresa un precio válido para el adicional.");
    }

    return {
        nombre,
        descripcion: descripcion || null,
        precio: Math.round(precio * 100) / 100
    };
}

// Eliminar una imagen anterior de producto (best-effort, nunca falla la respuesta).
async function eliminarImagenAnterior(rutaRelativa) {
    if (!rutaRelativa || !rutaRelativa.includes("/")) {
        return;
    }

    const [carpeta, nombreArchivo] = rutaRelativa.split("/");

    try {
        await fs.promises.unlink(rutaSeguraFoto(carpeta, nombreArchivo));
    } catch {
        // Si ya no existe o no se puede borrar, no es un error fatal.
    }
}

function responder(res, codigo, datos, cookies = []) {
    res.writeHead(codigo, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
        "Set-Cookie": cookies
    });

    res.end(JSON.stringify(datos));
}

function leerCookies(req) {
    const resultado = {};

    (req.headers.cookie || "").split(";").forEach((parte) => {
        const indice = parte.indexOf("=");

        if (indice > 0) {
            const nombre = parte.slice(0, indice).trim();
            const valor = parte.slice(indice + 1).trim();
            resultado[nombre] = valor;
        }
    });

    return resultado;
}

// Obtener una sesión según el tipo de usuario.
function obtenerSesion(req, tipo = "admin") {
    const nombreCookie =
            tipo === "cliente" ? "sesion_cliente" : "sesion_admin";

    const token = leerCookies(req)[nombreCookie];

    if (!token)
        return null;

    const sesion = sesiones.get(token);

    if (!sesion)
        return null;

    if (sesion.expira < Date.now()) {
        sesiones.delete(token);
        return null;
    }

    if (sesion.rol !== tipo)
        return null;

    return {token, ...sesion};
}

// Permitir el acceso administrativo únicamente a la administradora.
function exigirAdmin(req, res) {
    const sesion = obtenerSesion(req, "admin");

    if (!sesion) {
        responder(res, 401, {
            error: "Debes iniciar sesión como administradora."
        });
        return null;
    }

    return sesion;
}


function leerCuerpo(req) {
    return new Promise((resolve, reject) => {
        let cuerpo = "";
        let tamano = 0;

        req.on("data", (fragmento) => {
            tamano += fragmento.length;

            if (tamano > 10000) {
                reject(new Error("La solicitud es demasiado grande."));
                req.destroy();
                return;
            }

            cuerpo += fragmento;
        });

        req.on("end", () => {
            try {
                resolve(JSON.parse(cuerpo || "{}"));
            } catch {
                reject(new Error("El formato de los datos no es válido."));
            }
        });

        req.on("error", reject);
    });
}

// Crear una cookie diferente para cada rol.
function cookieSesion(token, rol) {
    const nombreCookie =
            rol === "admin" ? "sesion_admin" : "sesion_cliente";

    return `${nombreCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200`;
}

// Eliminar una cookie específica.
function borrarCookie(nombreCookie) {
    return `${nombreCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function enviarArchivo(req, res, rutaUrl) {
    let ruta;

    try {
        ruta = decodeURIComponent(rutaUrl.split("?")[0]);
    } catch {
        res.writeHead(400);
        res.end("Ruta no válida.");
        return;
    }

    if (ruta === "/")
        ruta = "/inicio.html";

    // No permitir acceso a archivos privados del servidor.
    if (
            ruta.startsWith("/.") ||
            ruta.includes("/.") ||
            /(^|\/)(server\.js|package\.json|package-lock\.json)$/i.test(ruta) ||
            ruta.startsWith("/node_modules/")
            ) {
        res.writeHead(403);
        res.end("Acceso denegado.");
        return;
    }

    const archivo = path.resolve(ROOT, "." + ruta);

    if (!archivo.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        res.end("Acceso denegado.");
        return;
    }

    const tipos = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff2": "font/woff2"
    };

    fs.readFile(archivo, (error, contenido) => {
        if (error) {
            res.writeHead(error.code === "ENOENT" ? 404 : 500);
            res.end("No se pudo encontrar el archivo.");
            return;
        }

        res.writeHead(200, {
            "Content-Type":
                    tipos[path.extname(archivo).toLowerCase()] ||
                    "application/octet-stream",
            "X-Content-Type-Options": "nosniff"
        });

        res.end(contenido);
    });
}

const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const ruta = url.pathname;

    try {
        if (req.method === "GET" && ruta === "/api/salud") {
            const [filas] = await pool.query("SELECT DATABASE() AS baseDatos");

            responder(res, 200, {
                estado: "correcto",
                mensaje: "Servidor conectado a MySQL",
                baseDatos: filas[0].baseDatos
            });
            return;
        }

        // Inicio de sesión para administradora y clientes.
        if (req.method === "POST" && ruta === "/api/login") {
            const datos = await leerCuerpo(req);
            const celular = String(datos.celular || "").trim();
            const password = String(datos.password || "");

            if (
                    !/^[0-9]{9,15}$/.test(celular) ||
                    !password ||
                    password.length > 200
                    ) {
                responder(res, 400, {
                    error: "Ingresa un celular y una contraseña válidos."
                });
                return;
            }

            const [usuarios] = await pool.execute(
                    `SELECT id, nombre, celular, password_hash, rol
                 FROM usuarios
                 WHERE celular = ? AND activo = TRUE
                 LIMIT 1`,
                    [celular]
                    );

            const usuario = usuarios[0];

            if (
                    !usuario ||
                    !(await bcrypt.compare(password, usuario.password_hash))
                    ) {
                responder(res, 401, {
                    error: "Celular o contraseña incorrectos."
                });
                return;
            }

            // Eliminar sesiones anteriores del mismo usuario y rol.
            for (const [tokenExistente, sesionExistente] of sesiones) {
                if (
                        sesionExistente.usuarioId === usuario.id &&
                        sesionExistente.rol === usuario.rol
                        ) {
                    sesiones.delete(tokenExistente);
                }
            }

            const token = crypto.randomBytes(32).toString("hex");

            sesiones.set(token, {
                usuarioId: usuario.id,
                nombre: usuario.nombre,
                celular: usuario.celular,
                rol: usuario.rol,
                expira: Date.now() + DURACION_SESION
            });

            responder(
                    res,
                    200,
                    {
                        mensaje: "Inicio de sesión correcto.",
                        usuario: {
                            id: usuario.id,
                            nombre: usuario.nombre,
                            celular: usuario.celular,
                            rol: usuario.rol
                        }
                    },
                    [cookieSesion(token, usuario.rol)]
                    );
            return;
        }

        // Registrar una nueva cuenta de cliente.
        if (req.method === "POST" && ruta === "/api/registro") {
            const datos = await leerCuerpo(req);

            const nombre = String(datos.nombre || "").trim();
            const celular = String(datos.celular || "").trim();
            const password = String(datos.password || "");

            if (nombre.length < 2 || nombre.length > 100) {
                responder(res, 400, {
                    error: "El nombre debe tener entre 2 y 100 caracteres."
                });
                return;
            }

            if (!/^[0-9]{9}$/.test(celular)) {
                responder(res, 400, {
                    error: "Ingresa un número de celular de 9 dígitos."
                });
                return;
            }

            if (password.length < 8 || password.length > 72) {
                responder(res, 400, {
                    error: "La contraseña debe tener entre 8 y 72 caracteres."
                });
                return;
            }

            const [existentes] = await pool.execute(
                    "SELECT id FROM usuarios WHERE celular = ? LIMIT 1",
                    [celular]
                    );

            if (existentes.length > 0) {
                responder(res, 409, {
                    error: "Este número de celular ya está registrado."
                });
                return;
            }

            const passwordHash = await bcrypt.hash(password, 12);

            await pool.execute(
                    `INSERT INTO usuarios
                    (nombre, celular, password_hash, rol, activo)
                 VALUES (?, ?, ?, 'cliente', TRUE)`,
                    [nombre, celular, passwordHash]
                    );

            responder(res, 201, {
                mensaje: "Cuenta creada correctamente. Ya puedes iniciar sesión."
            });
            return;
        }

        // Consultar la sesión actual de cualquier usuario.
        if (req.method === "GET" && ruta === "/api/sesion") {
            const sesion =
                    obtenerSesion(req, "admin") ||
                    obtenerSesion(req, "cliente");

            if (!sesion) {
                responder(res, 401, {autenticado: false});
                return;
            }

            responder(res, 200, {
                autenticado: true,
                usuario: {
                    id: sesion.usuarioId,
                    nombre: sesion.nombre,
                    celular: sesion.celular,
                    rol: sesion.rol
                }
            });
            return;
        }


// Consultar el progreso de fidelización del cliente.
        if (req.method === "GET" && ruta === "/api/cliente/fidelizacion") {

            const sesion = obtenerSesion(req, "cliente");

            if (!sesion) {
                responder(res, 401, {
                    error: "Debes iniciar sesión como cliente."
                });
                return;
            }

            const [[resultado]] = await pool.execute(
                    `SELECT COUNT(*) AS comprasEntregadas
         FROM pedidos
         WHERE usuario_id = ?
         AND estado = 'entregado'`,
                    [sesion.usuarioId]
                    );

            const compras = Number(resultado.comprasEntregadas);

            const [beneficios] = await pool.execute(
                    `SELECT beneficio, entregado
                 FROM entregas_fidelizacion
                 WHERE usuario_id = ? AND entregado = 1`,
                    [sesion.usuarioId]
                    );

            const primeraCompraEntregada = beneficios.some(
                    (fila) => fila.beneficio === "primera_compra"
                    );

            const novenaCompraEntregada = beneficios.some(
                    (fila) => fila.beneficio === "novena_compra"
                    );

            responder(res, 200, {
                comprasEntregadas: compras,
                progresoNovena: Math.min(compras, 8),
                primeraCompraCompletada: compras >= 1,
                premioNovenaCompletado: compras >= 9,
                primeraCompraEntregada,
                novenaCompraEntregada
            });

            return;
        }

        // Historial de compras entregadas del propio cliente autenticado.
        if (req.method === "GET" && ruta === "/api/cliente/fidelizacion/historial") {
            const sesion = obtenerSesion(req, "cliente");

            if (!sesion) {
                responder(res, 401, {
                    error: "Debes iniciar sesión como cliente."
                });
                return;
            }

            const [historial] = await pool.execute(
                    `SELECT id, total, fecha_entregada
                 FROM pedidos
                 WHERE usuario_id = ? AND estado = 'entregado'
                 ORDER BY fecha_entregada DESC`,
                    [sesion.usuarioId]
                    );

            responder(res, 200, {historial});
            return;
        }

        // Pares pedido+producto entregados que el cliente todavía puede reseñar.
        if (req.method === "GET" && ruta === "/api/cliente/resenas/pendientes") {
            const sesion = obtenerSesion(req, "cliente");

            if (!sesion) {
                responder(res, 401, {
                    error: "Debes iniciar sesión como cliente."
                });
                return;
            }

            const [pendientes] = await pool.execute(
                    `SELECT dp.pedido_id AS pedidoId, dp.producto_id AS productoId,
                            dp.nombre_producto AS nombreProducto, p.fecha_entregada AS fechaEntregada
                 FROM detalle_pedido dp
                 INNER JOIN pedidos p ON p.id = dp.pedido_id
                 LEFT JOIN resenas r
                        ON r.pedido_id = dp.pedido_id AND r.producto_id = dp.producto_id
                 WHERE p.usuario_id = ?
                   AND p.estado = 'entregado'
                   AND dp.producto_id IS NOT NULL
                   AND r.id IS NULL
                 ORDER BY p.fecha_entregada DESC`,
                    [sesion.usuarioId]
                    );

            responder(res, 200, {pendientes});
            return;
        }

        // Registrar una nueva reseña del cliente autenticado.
        if (req.method === "POST" && ruta === "/api/cliente/resenas") {
            const sesion = obtenerSesion(req, "cliente");

            if (!sesion) {
                responder(res, 401, {
                    error: "Debes iniciar sesión como cliente."
                });
                return;
            }

            let cuerpo;

            try {
                cuerpo = await leerCuerpoMultipart(req, TAMANO_MAXIMO_IMAGEN);
            } catch (error) {
                responder(res, 400, {error: error.message});
                return;
            }

            const campos = cuerpo.campos;
            const pedidoId = Number(campos.pedidoId);
            const productoId = Number(campos.productoId);
            const calificacion = Number(campos.calificacion);
            const comentario = String(campos.comentario || "").trim();

            if (!Number.isInteger(pedidoId) || !Number.isInteger(productoId)) {
                responder(res, 400, {error: "Pedido o producto no válidos."});
                return;
            }

            if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
                responder(res, 400, {error: "La calificación debe ser de 1 a 5 estrellas."});
                return;
            }

            if (!comentario || comentario.length > 1000) {
                responder(res, 400, {
                    error: "El comentario es obligatorio y debe tener como máximo 1000 caracteres."
                });
                return;
            }

            // El pedido debe ser del cliente autenticado (nunca se confía en un id
            // enviado por el navegador) y debe estar entregado.
            const [[pedido]] = await pool.execute(
                    `SELECT id FROM pedidos
                 WHERE id = ? AND usuario_id = ? AND estado = 'entregado'`,
                    [pedidoId, sesion.usuarioId]
                    );

            if (!pedido) {
                responder(res, 403, {
                    error: "Solo puedes reseñar productos de pedidos entregados y que te pertenezcan."
                });
                return;
            }

            // El producto debe pertenecer realmente a ese pedido.
            const [[detalle]] = await pool.execute(
                    `SELECT id FROM detalle_pedido
                 WHERE pedido_id = ? AND producto_id = ?`,
                    [pedidoId, productoId]
                    );

            if (!detalle) {
                responder(res, 400, {
                    error: "Ese producto no pertenece al pedido indicado."
                });
                return;
            }

            const archivo = cuerpo.archivos.foto;
            let imagenPendiente = null;
            let rutaFotografia = null;

            if (archivo && archivo.datos && archivo.datos.length) {
                const tipoImagen = detectarTipoImagen(archivo.datos);

                if (!tipoImagen) {
                    responder(res, 400, {
                        error: "La fotografía debe ser un archivo PNG, JPG o WEBP válido."
                    });
                    return;
                }

                const nombreArchivo =
                        `${crypto.randomBytes(16).toString("hex")}.${tipoImagen}`;

                const carpetaAbsoluta = path.resolve(ROOT, "fotos", "resenas");
                await fs.promises.mkdir(carpetaAbsoluta, {recursive: true});

                const rutaFinal = rutaSeguraFoto("resenas", nombreArchivo);
                await fs.promises.writeFile(rutaFinal, archivo.datos);

                imagenPendiente = rutaFinal;
                rutaFotografia = `resenas/${nombreArchivo}`;
            }

            try {
                await pool.execute(
                        `INSERT INTO resenas
                        (usuario_id, pedido_id, producto_id, calificacion,
                         comentario, fotografia, estado)
                     VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`,
                        [
                            sesion.usuarioId, pedidoId, productoId,
                            calificacion, comentario, rutaFotografia
                        ]
                        );

                responder(res, 201, {
                    mensaje: "Reseña enviada. Quedará publicada luego de ser revisada."
                });
                return;
            } catch (error) {
                // El UNIQUE KEY (pedido_id, producto_id) es la segunda barrera
                // contra duplicados (recargas, doble solicitud, etc.).
                if (imagenPendiente) {
                    await fs.promises.unlink(imagenPendiente).catch(() => {});
                }

                if (error.code === "ER_DUP_ENTRY") {
                    responder(res, 409, {
                        error: "Ya enviaste una reseña para este producto de este pedido."
                    });
                    return;
                }

                throw error;
            }
        }

        // Reseñas que el propio cliente autenticado ha escrito.
        if (req.method === "GET" && ruta === "/api/cliente/resenas") {
            const sesion = obtenerSesion(req, "cliente");

            if (!sesion) {
                responder(res, 401, {
                    error: "Debes iniciar sesión como cliente."
                });
                return;
            }

            const [resenas] = await pool.execute(
                    `SELECT r.id, r.producto_id AS productoId, pr.nombre AS nombreProducto,
                            r.calificacion, r.comentario, r.fotografia, r.estado, r.creado_en
                 FROM resenas r
                 LEFT JOIN productos pr ON pr.id = r.producto_id
                 WHERE r.usuario_id = ?
                 ORDER BY r.creado_en DESC`,
                    [sesion.usuarioId]
                    );

            responder(res, 200, {resenas});
            return;
        }

        // Cerrar sesión del usuario actual.
        if (req.method === "POST" && ruta === "/api/logout") {
            const sesion =
                    obtenerSesion(req, "admin") ||
                    obtenerSesion(req, "cliente");

            if (sesion) {
                sesiones.delete(sesion.token);
            }

            responder(
                    res,
                    200,
                    {mensaje: "Sesión cerrada."},
                    [
                        borrarCookie("sesion_admin"),
                        borrarCookie("sesion_cliente")
                    ]
                    );
            return;
        }



        // Catálogo público de productos desde MySQL.
        if (req.method === "GET" && ruta === "/api/productos") {
            const [filas] = await pool.query(
                    `SELECT
                    id,
                    nombre,
                    slug,
                    categoria,
                    descripcion,
                    imagen,
                    precio,
                    detalles,
                    anticipacion,
                    pedido_minimo,
                    unidad_venta,
                    unidades_por_caja,
                    presentaciones
                 FROM productos
                 WHERE disponible = TRUE
                 ORDER BY categoria, nombre`
                    );

            const productos = filas.map((producto) => {
                const partesImagen = (producto.imagen || "").split("/");

                return {
                    ...producto,
                    carpeta: partesImagen.length > 1
                            ? partesImagen[0]
                            : "",
                    imagen: partesImagen.length > 1
                            ? partesImagen.slice(1).join("/")
                            : partesImagen[0],
                    detalles: producto.detalles || {},
                    presentaciones: producto.presentaciones || null,
                    precio: producto.precio === null
                            ? null
                            : Number(producto.precio)
                };
            });

            responder(res, 200, {productos});
            return;
        }


        // Galería pública de diseños personalizados (solo los activos).
        if (req.method === "GET" && ruta === "/api/galeria") {
            const [diseños] = await pool.query(
                    `SELECT id, nombre, categoria, imagen
                     FROM galeria
                     WHERE activo = TRUE
                     ORDER BY creado_en DESC`
                    );

            responder(res, 200, {galeria: diseños});
            return;
        }


        // Configuración pública: datos del negocio, horarios, y únicamente
        // el número de días de anticipación mínima (lo necesita el carrito
        // para la fecha de recojo). Nunca metodos_pago (información
        // bancaria) ni el resto de condiciones_pedido (administrativo).
        if (req.method === "GET" && ruta === "/api/configuracion") {
            const [[fila]] = await pool.query(
                    `SELECT datos_negocio, horarios, condiciones_pedido
                     FROM configuracion WHERE id = 1`
                    );

            const anticipacionMinimaDias = Number(
                    fila?.condiciones_pedido?.anticipacionMinimaDias
                    );

            responder(res, 200, {
                datosNegocio: fila ? fila.datos_negocio : null,
                horarios: fila ? fila.horarios : null,
                anticipacionMinimaDias: Number.isInteger(anticipacionMinimaDias)
                        ? anticipacionMinimaDias
                        : ANTICIPACION_MINIMA_RESPALDO
            });
            return;
        }


        // Registrar un pedido del cliente y sus productos.
        if (req.method === "POST" && ruta === "/api/pedidos") {
            const sesion = obtenerSesion(req, "cliente");

            if (!sesion) {
                responder(res, 401, {
                    error: "Inicia sesión como cliente para realizar tu pedido."
                });
                return;
            }

            const datos = await leerCuerpo(req);
            const items = datos.items;

            if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
                responder(res, 400, {
                    error: "El carrito está vacío o contiene demasiados productos."
                });
                return;
            }

            // La fecha, hora y lugar de recojo ya no se piden en el carrito:
            // el pedido entra como "pendiente" sin coordinar, y la dueña los
            // registra ella misma desde el panel (PATCH /entrega) después de
            // acordarlos con el cliente por WhatsApp.
            const conexion = await pool.getConnection();

            try {
                await conexion.beginTransaction();

                const {detalles, subtotal} = await resolverDetallesPedido(
                        conexion,
                        items
                        );

                const [resultadoPedido] = await conexion.execute(
                        `INSERT INTO pedidos
                        (usuario_id, nombre_cliente, celular_cliente,
                         tipo_entrega, direccion_entrega, fecha_solicitada,
                         hora_solicitada, estado, subtotal, costo_delivery,
                         total, notas, origen)
                     VALUES (?, ?, ?, 'recojo', NULL, NULL,
                             NULL, 'pendiente', ?, 0.00, ?, NULL, 'web')`,
                        [
                            sesion.usuarioId,
                            sesion.nombre,
                            sesion.celular,
                            subtotal,
                            subtotal
                        ]
                        );

                const pedidoId = resultadoPedido.insertId;

                for (const detalle of detalles) {
                    await conexion.execute(
                            `INSERT INTO detalle_pedido
                            (pedido_id, producto_id, nombre_producto,
                             presentacion, cantidad, precio_unitario, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [
                                pedidoId,
                                detalle.productoId,
                                detalle.nombre,
                                detalle.presentacion || null,
                                detalle.cantidad,
                                detalle.precio,
                                detalle.subtotal
                            ]
                            );
                }

                await conexion.commit();

                responder(res, 201, {
                    mensaje: "Pedido registrado correctamente.",
                    pedidoId,
                    cliente: {
                        nombre: sesion.nombre,
                        celular: sesion.celular
                    },
                    subtotal,
                    costoDelivery: 0,
                    total: subtotal,
                    tipoEntrega: "recojo",
                    items: detalles
                });
                return;

            } catch (error) {
                await conexion.rollback();

                const errorCliente = [
                    "Producto o cantidad no válidos.",
                    "Uno de los productos ya no está disponible.",
                    "No se pudo verificar el precio de un producto.",
                    "La presentación seleccionada no es válida para este producto."
                ].includes(error.message);

                responder(res, errorCliente ? 400 : 500, {
                    error: errorCliente
                            ? error.message
                            : "No se pudo guardar el pedido. Inténtalo nuevamente."
                });
                return;

            } finally {
                conexion.release();
            }
        }

        // Reseñas aprobadas, públicas, visibles para cualquier visitante.
        if (req.method === "GET" && ruta === "/api/resenas") {
            const [resenas] = await pool.query(
                    `SELECT r.id, u.nombre AS nombreCliente, pr.nombre AS nombreProducto,
                            r.calificacion, r.comentario, r.fotografia, r.creado_en
                 FROM resenas r
                 INNER JOIN usuarios u ON u.id = r.usuario_id
                 LEFT JOIN productos pr ON pr.id = r.producto_id
                 WHERE r.estado = 'aprobada'
                 ORDER BY r.creado_en DESC
                 LIMIT 100`
                    );

            responder(res, 200, {resenas});
            return;
        }

        // Todas las siguientes rutas requieren una sesión de administradora.
        if (ruta.startsWith("/api/admin/")) {
            const sesion = exigirAdmin(req, res);

            if (!sesion)
                return;

            if (req.method === "GET" && ruta === "/api/admin/resumen") {
                const [[productos]] = await pool.query(
                        "SELECT COUNT(*) AS total FROM productos"
                        );

                const [[disponibles]] = await pool.query(
                        "SELECT COUNT(*) AS total FROM productos WHERE disponible = TRUE"
                        );

                // Pedidos activos: aún no entregados ni cancelados.
                const [[activos]] = await pool.query(
                        `SELECT COUNT(*) AS total
                     FROM pedidos
                     WHERE estado IN ('pendiente', 'confirmado')`
                        );

                // Pedidos recientes, ocultando los cancelados con más de 24 h desde su cancelación.
                const [ultimosPedidos] = await pool.query(
                        `SELECT id, nombre_cliente, celular_cliente,
                            total, estado, creado_en
                     FROM pedidos
                     WHERE estado <> 'cancelado'
                        OR (cancelado_en IS NOT NULL AND cancelado_en >= NOW() - INTERVAL 24 HOUR)
                     ORDER BY creado_en DESC
                     LIMIT 10`
                        );

                // Próximas entregas: pedidos activos con fecha programada.
                const [proximasEntregas] = await pool.query(
                        `SELECT p.id, p.nombre_cliente, p.fecha_solicitada, p.hora_solicitada,
                            GROUP_CONCAT(dp.nombre_producto, ' x', dp.cantidad ORDER BY dp.id SEPARATOR ', ') AS productos
                     FROM pedidos p
                     LEFT JOIN detalle_pedido dp ON dp.pedido_id = p.id
                     WHERE p.estado IN ('pendiente', 'confirmado')
                       AND p.fecha_solicitada IS NOT NULL
                     GROUP BY p.id, p.nombre_cliente, p.fecha_solicitada, p.hora_solicitada
                     ORDER BY p.fecha_solicitada ASC, p.hora_solicitada ASC
                     LIMIT 10`
                        );

                // Pedidos entregados este mes según su fecha real de entrega.
                const [[entregadosMes]] = await pool.query(
                        `SELECT COUNT(*) AS total
                     FROM pedidos
                     WHERE estado = 'entregado'
                       AND fecha_entregada IS NOT NULL
                       AND YEAR(fecha_entregada) = YEAR(CURDATE())
                       AND MONTH(fecha_entregada) = MONTH(CURDATE())`
                        );

                // Productos más vendidos este mes entre los pedidos entregados.
                const [masVendidosMes] = await pool.query(
                        `SELECT dp.nombre_producto AS nombre, SUM(dp.cantidad) AS cantidad
                     FROM detalle_pedido dp
                     INNER JOIN pedidos p ON p.id = dp.pedido_id
                     WHERE p.estado = 'entregado'
                       AND p.fecha_entregada IS NOT NULL
                       AND YEAR(p.fecha_entregada) = YEAR(CURDATE())
                       AND MONTH(p.fecha_entregada) = MONTH(CURDATE())
                     GROUP BY dp.producto_id, dp.nombre_producto
                     ORDER BY cantidad DESC
                     LIMIT 5`
                        );

                responder(res, 200, {
                    pedidosActivos: activos.total,
                    pedidosEntregadosMes: entregadosMes.total,
                    productosDisponibles: disponibles.total,
                    totalProductos: productos.total,
                    ultimosPedidos,
                    proximasEntregas,
                    productosMasVendidosMes: masVendidosMes.map((fila) => ({
                        nombre: fila.nombre,
                        cantidad: Number(fila.cantidad)
                    }))
                });
                return;
            }

            // Listado de productos para el panel, con filtros opcionales.
            if (req.method === "GET" && ruta === "/api/admin/productos") {
                const categoriaFiltro = url.searchParams.get("categoria") || "";
                const estadoFiltro = url.searchParams.get("estado") || "";

                const condiciones = [];
                const parametros = [];

                if (Object.prototype.hasOwnProperty.call(CARPETA_POR_CATEGORIA, categoriaFiltro)) {
                    condiciones.push("categoria = ?");
                    parametros.push(categoriaFiltro);
                }

                if (estadoFiltro === "activos") {
                    condiciones.push("disponible = TRUE");
                } else if (estadoFiltro === "inactivos") {
                    condiciones.push("disponible = FALSE");
                }

                const clausulaWhere = condiciones.length
                        ? `WHERE ${condiciones.join(" AND ")}`
                        : "";

                const [productos] = await pool.query(
                        `SELECT id, nombre, slug, categoria, descripcion, imagen,
                                precio, disponible, anticipacion, pedido_minimo,
                                unidad_venta, unidades_por_caja, detalles, presentaciones
                         FROM productos
                         ${clausulaWhere}
                         ORDER BY nombre`,
                        parametros
                        );

                responder(res, 200, {productos});
                return;
            }

            // Detalle de un producto, para precargar el formulario de edición.
            const coincidenciaProductoDetalle = ruta.match(/^\/api\/admin\/productos\/(\d+)$/);

            if (req.method === "GET" && coincidenciaProductoDetalle) {
                const [[producto]] = await pool.execute(
                        `SELECT id, nombre, slug, categoria, descripcion, imagen,
                                precio, disponible, anticipacion, pedido_minimo,
                                unidad_venta, unidades_por_caja, detalles, presentaciones
                         FROM productos WHERE id = ?`,
                        [Number(coincidenciaProductoDetalle[1])]
                        );

                if (!producto) {
                    responder(res, 404, {error: "Producto no encontrado."});
                    return;
                }

                responder(res, 200, {producto});
                return;
            }

            // Registrar un nuevo producto (REGISTRAR).
            if (req.method === "POST" && ruta === "/api/admin/productos") {
                let cuerpo;

                try {
                    cuerpo = await leerCuerpoMultipart(req, TAMANO_MAXIMO_IMAGEN);
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                const campos = cuerpo.campos;
                const nombre = String(campos.nombre || "").trim();
                const categoria = String(campos.categoria || "").trim();
                const descripcion = String(campos.descripcion || "").trim();
                const precio = Number(campos.precio);
                const unidadVenta = String(campos.unidad_venta || "").trim();
                const unidadesPorCaja = campos.unidades_por_caja
                        ? Number(campos.unidades_por_caja)
                        : null;
                const pedidoMinimo = campos.pedido_minimo
                        ? Number(campos.pedido_minimo)
                        : null;
                const anticipacion = String(campos.anticipacion || "").trim();
                const disponible =
                        campos.disponible === "0" || campos.disponible === "false"
                        ? 0
                        : 1;

                if (nombre.length < 2 || nombre.length > 150) {
                    responder(res, 400, {
                        error: "El nombre debe tener entre 2 y 150 caracteres."
                    });
                    return;
                }

                if (!Object.prototype.hasOwnProperty.call(CARPETA_POR_CATEGORIA, categoria)) {
                    responder(res, 400, {error: "Selecciona una categoría válida."});
                    return;
                }

                if (!Number.isFinite(precio) || precio < 0) {
                    responder(res, 400, {error: "Ingresa un precio válido."});
                    return;
                }

                let detallesValidado;
                let presentacionesValidado;

                try {
                    const detallesCrudo = parsearCampoJSON(campos.detalles);
                    detallesValidado = validarDetallesProducto(
                            detallesCrudo === undefined ? null : detallesCrudo
                            );

                    const presentacionesCrudo = parsearCampoJSON(campos.presentaciones);
                    presentacionesValidado = validarPresentacionesProducto(
                            presentacionesCrudo === undefined ? null : presentacionesCrudo
                            );
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                const archivo = cuerpo.archivos.imagen;

                if (!archivo || !archivo.datos || !archivo.datos.length) {
                    responder(res, 400, {error: "La imagen del producto es obligatoria."});
                    return;
                }

                const tipoImagen = detectarTipoImagen(archivo.datos);

                if (!tipoImagen) {
                    responder(res, 400, {
                        error: "La imagen debe ser un archivo PNG, JPG o WEBP válido."
                    });
                    return;
                }

                const conexion = await pool.getConnection();
                let imagenPendiente = null;

                try {
                    await conexion.beginTransaction();

                    const slug = await generarSlugUnico(conexion, nombre);
                    const carpeta = CARPETA_POR_CATEGORIA[categoria];

                    imagenPendiente = await guardarImagenProducto(
                            carpeta, slug, tipoImagen, archivo.datos
                            );

                    await conexion.execute(
                            `INSERT INTO productos
                            (nombre, slug, categoria, descripcion, imagen, precio,
                             disponible, anticipacion, pedido_minimo, unidad_venta,
                             unidades_por_caja, detalles, presentaciones)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                nombre, slug, categoria, descripcion || null,
                                imagenPendiente.rutaRelativa, precio, disponible,
                                anticipacion || null, pedidoMinimo,
                                unidadVenta || null, unidadesPorCaja,
                                detallesValidado ? JSON.stringify(detallesValidado) : null,
                                presentacionesValidado
                                        ? JSON.stringify(presentacionesValidado)
                                        : null
                            ]
                            );

                    await conexion.commit();
                    await imagenPendiente.confirmar();

                    responder(res, 201, {
                        mensaje: "Producto registrado correctamente.",
                        slug
                    });
                    return;
                } catch (error) {
                    await conexion.rollback();

                    if (imagenPendiente) {
                        await imagenPendiente.descartar();
                    }

                    responder(res, 500, {
                        error: "No se pudo registrar el producto. Inténtalo nuevamente."
                    });
                    return;
                } finally {
                    conexion.release();
                }
            }

            // Modificar un producto existente (MODIFICAR).
            const coincidenciaProductoEditar = ruta.match(/^\/api\/admin\/productos\/(\d+)$/);

            if (req.method === "PUT" && coincidenciaProductoEditar) {
                const id = Number(coincidenciaProductoEditar[1]);

                let cuerpo;

                try {
                    cuerpo = await leerCuerpoMultipart(req, TAMANO_MAXIMO_IMAGEN);
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                const campos = cuerpo.campos;
                const nombre = String(campos.nombre || "").trim();
                const categoria = String(campos.categoria || "").trim();
                const descripcion = String(campos.descripcion || "").trim();
                const precio = Number(campos.precio);
                const unidadVenta = String(campos.unidad_venta || "").trim();
                const unidadesPorCaja = campos.unidades_por_caja
                        ? Number(campos.unidades_por_caja)
                        : null;
                const pedidoMinimo = campos.pedido_minimo
                        ? Number(campos.pedido_minimo)
                        : null;
                const anticipacion = String(campos.anticipacion || "").trim();

                if (nombre.length < 2 || nombre.length > 150) {
                    responder(res, 400, {
                        error: "El nombre debe tener entre 2 y 150 caracteres."
                    });
                    return;
                }

                if (!Object.prototype.hasOwnProperty.call(CARPETA_POR_CATEGORIA, categoria)) {
                    responder(res, 400, {error: "Selecciona una categoría válida."});
                    return;
                }

                if (!Number.isFinite(precio) || precio < 0) {
                    responder(res, 400, {error: "Ingresa un precio válido."});
                    return;
                }

                const [[productoActual]] = await pool.execute(
                        "SELECT slug, imagen, detalles, presentaciones FROM productos WHERE id = ?",
                        [id]
                        );

                if (!productoActual) {
                    responder(res, 404, {error: "Producto no encontrado."});
                    return;
                }

                // Si el campo no llega en el formulario, se conserva el valor
                // actual sin tocarlo (por ejemplo, productos con presentaciones
                // en formato antiguo que el formulario no sabe editar).
                let detallesFinal = productoActual.detalles;
                let presentacionesFinal = productoActual.presentaciones;

                try {
                    const detallesCrudo = parsearCampoJSON(campos.detalles);

                    if (detallesCrudo !== undefined) {
                        detallesFinal = validarDetallesProducto(detallesCrudo);
                    }

                    const presentacionesCrudo = parsearCampoJSON(campos.presentaciones);

                    if (presentacionesCrudo !== undefined) {
                        presentacionesFinal = validarPresentacionesProducto(presentacionesCrudo);
                    }
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                const archivo = cuerpo.archivos.imagen;
                const haySubidaNueva = Boolean(archivo && archivo.datos && archivo.datos.length);

                let tipoImagen = null;

                if (haySubidaNueva) {
                    tipoImagen = detectarTipoImagen(archivo.datos);

                    if (!tipoImagen) {
                        responder(res, 400, {
                            error: "La imagen debe ser un archivo PNG, JPG o WEBP válido."
                        });
                        return;
                    }
                }

                const conexion = await pool.getConnection();
                let imagenPendiente = null;

                // Si no se sube una imagen nueva, se conserva la actual tal cual,
                // sin importar que la categoría haya cambiado.
                let rutaImagenFinal = productoActual.imagen;

                try {
                    await conexion.beginTransaction();

                    if (haySubidaNueva) {
                        const carpeta = CARPETA_POR_CATEGORIA[categoria];

                        imagenPendiente = await guardarImagenProducto(
                                carpeta, productoActual.slug, tipoImagen, archivo.datos
                                );

                        rutaImagenFinal = imagenPendiente.rutaRelativa;
                    }

                    await conexion.execute(
                            `UPDATE productos
                             SET nombre = ?, categoria = ?, descripcion = ?,
                                 imagen = ?, precio = ?, anticipacion = ?,
                                 pedido_minimo = ?, unidad_venta = ?,
                                 unidades_por_caja = ?, detalles = ?, presentaciones = ?
                             WHERE id = ?`,
                            [
                                nombre, categoria, descripcion || null,
                                rutaImagenFinal, precio, anticipacion || null,
                                pedidoMinimo, unidadVenta || null, unidadesPorCaja,
                                detallesFinal ? JSON.stringify(detallesFinal) : null,
                                presentacionesFinal ? JSON.stringify(presentacionesFinal) : null,
                                id
                            ]
                            );

                    await conexion.commit();

                    if (imagenPendiente) {
                        await imagenPendiente.confirmar();

                        if (productoActual.imagen && productoActual.imagen !== rutaImagenFinal) {
                            await eliminarImagenAnterior(productoActual.imagen);
                        }
                    }

                    responder(res, 200, {mensaje: "Producto actualizado correctamente."});
                    return;
                } catch (error) {
                    await conexion.rollback();

                    if (imagenPendiente) {
                        await imagenPendiente.descartar();
                    }

                    responder(res, 500, {
                        error: "No se pudo actualizar el producto. Inténtalo nuevamente."
                    });
                    return;
                } finally {
                    conexion.release();
                }
            }

            // Dar de baja o reactivar un producto, sin borrarlo (DAR DE BAJA / REACTIVAR).
            const coincidenciaProductoEstado = ruta.match(
                    /^\/api\/admin\/productos\/(\d+)\/estado$/
                    );

            if (req.method === "PATCH" && coincidenciaProductoEstado) {
                const id = Number(coincidenciaProductoEstado[1]);
                const datos = await leerCuerpo(req);

                if (typeof datos.disponible !== "boolean") {
                    responder(res, 400, {error: "Estado no válido."});
                    return;
                }

                const [resultado] = await pool.execute(
                        "UPDATE productos SET disponible = ? WHERE id = ?",
                        [datos.disponible ? 1 : 0, id]
                        );

                if (!resultado.affectedRows) {
                    responder(res, 404, {error: "Producto no encontrado."});
                    return;
                }

                responder(res, 200, {
                    mensaje: datos.disponible
                            ? "Producto reactivado correctamente."
                            : "Producto dado de baja correctamente."
                });
                return;
            }

            // Listado de diseños de galería para el panel, con filtros opcionales.
            if (req.method === "GET" && ruta === "/api/admin/galeria") {
                const categoriaFiltro = url.searchParams.get("categoria") || "";
                const estadoFiltro = url.searchParams.get("estado") || "";

                const condiciones = [];
                const parametros = [];

                if (CATEGORIAS_GALERIA.includes(categoriaFiltro)) {
                    condiciones.push("categoria = ?");
                    parametros.push(categoriaFiltro);
                }

                if (estadoFiltro === "activos") {
                    condiciones.push("activo = TRUE");
                } else if (estadoFiltro === "inactivos") {
                    condiciones.push("activo = FALSE");
                }

                const clausulaWhere = condiciones.length
                        ? `WHERE ${condiciones.join(" AND ")}`
                        : "";

                const [diseños] = await pool.query(
                        `SELECT id, nombre, categoria, imagen, activo, creado_en
                         FROM galeria
                         ${clausulaWhere}
                         ORDER BY creado_en DESC`,
                        parametros
                        );

                responder(res, 200, {galeria: diseños});
                return;
            }

            // Detalle de un diseño, para precargar el formulario de edición.
            const coincidenciaGaleriaDetalle = ruta.match(/^\/api\/admin\/galeria\/(\d+)$/);

            if (req.method === "GET" && coincidenciaGaleriaDetalle) {
                const [[diseno]] = await pool.execute(
                        `SELECT id, nombre, categoria, imagen, activo
                         FROM galeria WHERE id = ?`,
                        [Number(coincidenciaGaleriaDetalle[1])]
                        );

                if (!diseno) {
                    responder(res, 404, {error: "Diseño no encontrado."});
                    return;
                }

                responder(res, 200, {diseno});
                return;
            }

            // Registrar un nuevo diseño de galería.
            if (req.method === "POST" && ruta === "/api/admin/galeria") {
                let cuerpo;

                try {
                    cuerpo = await leerCuerpoMultipart(req, TAMANO_MAXIMO_IMAGEN);
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                const campos = cuerpo.campos;
                const nombre = String(campos.nombre || "").trim();
                const categoria = String(campos.categoria || "").trim();
                const activo =
                        campos.activo === "0" || campos.activo === "false" ? 0 : 1;

                if (nombre.length < 2 || nombre.length > 150) {
                    responder(res, 400, {
                        error: "El nombre debe tener entre 2 y 150 caracteres."
                    });
                    return;
                }

                if (!CATEGORIAS_GALERIA.includes(categoria)) {
                    responder(res, 400, {error: "Selecciona una clasificación válida."});
                    return;
                }

                const archivo = cuerpo.archivos.imagen;

                if (!archivo || !archivo.datos || !archivo.datos.length) {
                    responder(res, 400, {error: "La fotografía del diseño es obligatoria."});
                    return;
                }

                const tipoImagen = detectarTipoImagen(archivo.datos);

                if (!tipoImagen) {
                    responder(res, 400, {
                        error: "La fotografía debe ser un archivo PNG, JPG o WEBP válido."
                    });
                    return;
                }

                const nombreArchivo =
                        `${crypto.randomBytes(16).toString("hex")}.${tipoImagen}`;

                const carpetaAbsoluta = path.resolve(ROOT, "fotos", "galeria");
                await fs.promises.mkdir(carpetaAbsoluta, {recursive: true});

                const rutaFinal = rutaSeguraFoto("galeria", nombreArchivo);
                await fs.promises.writeFile(rutaFinal, archivo.datos);

                const rutaImagen = `galeria/${nombreArchivo}`;

                try {
                    await pool.execute(
                            `INSERT INTO galeria (nombre, categoria, imagen, activo)
                             VALUES (?, ?, ?, ?)`,
                            [nombre, categoria, rutaImagen, activo]
                            );

                    responder(res, 201, {mensaje: "Diseño registrado correctamente."});
                    return;
                } catch (error) {
                    await fs.promises.unlink(rutaFinal).catch(() => {});

                    responder(res, 500, {
                        error: "No se pudo registrar el diseño. Inténtalo nuevamente."
                    });
                    return;
                }
            }

            // Modificar un diseño existente.
            const coincidenciaGaleriaEditar = ruta.match(/^\/api\/admin\/galeria\/(\d+)$/);

            if (req.method === "PUT" && coincidenciaGaleriaEditar) {
                const id = Number(coincidenciaGaleriaEditar[1]);

                let cuerpo;

                try {
                    cuerpo = await leerCuerpoMultipart(req, TAMANO_MAXIMO_IMAGEN);
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                const campos = cuerpo.campos;
                const nombre = String(campos.nombre || "").trim();
                const categoria = String(campos.categoria || "").trim();

                if (nombre.length < 2 || nombre.length > 150) {
                    responder(res, 400, {
                        error: "El nombre debe tener entre 2 y 150 caracteres."
                    });
                    return;
                }

                if (!CATEGORIAS_GALERIA.includes(categoria)) {
                    responder(res, 400, {error: "Selecciona una clasificación válida."});
                    return;
                }

                const [[disenoActual]] = await pool.execute(
                        "SELECT imagen FROM galeria WHERE id = ?",
                        [id]
                        );

                if (!disenoActual) {
                    responder(res, 404, {error: "Diseño no encontrado."});
                    return;
                }

                const archivo = cuerpo.archivos.imagen;
                const haySubidaNueva =
                        Boolean(archivo && archivo.datos && archivo.datos.length);

                let rutaImagenFinal = disenoActual.imagen;
                let rutaNuevaAbsoluta = null;

                if (haySubidaNueva) {
                    const tipoImagen = detectarTipoImagen(archivo.datos);

                    if (!tipoImagen) {
                        responder(res, 400, {
                            error: "La fotografía debe ser un archivo PNG, JPG o WEBP válido."
                        });
                        return;
                    }

                    const nombreArchivo =
                            `${crypto.randomBytes(16).toString("hex")}.${tipoImagen}`;

                    const carpetaAbsoluta = path.resolve(ROOT, "fotos", "galeria");
                    await fs.promises.mkdir(carpetaAbsoluta, {recursive: true});

                    rutaNuevaAbsoluta = rutaSeguraFoto("galeria", nombreArchivo);
                    await fs.promises.writeFile(rutaNuevaAbsoluta, archivo.datos);

                    rutaImagenFinal = `galeria/${nombreArchivo}`;
                }

                try {
                    await pool.execute(
                            `UPDATE galeria SET nombre = ?, categoria = ?, imagen = ? WHERE id = ?`,
                            [nombre, categoria, rutaImagenFinal, id]
                            );

                    if (haySubidaNueva && disenoActual.imagen) {
                        await eliminarImagenAnterior(disenoActual.imagen);
                    }

                    responder(res, 200, {mensaje: "Diseño actualizado correctamente."});
                    return;
                } catch (error) {
                    if (rutaNuevaAbsoluta) {
                        await fs.promises.unlink(rutaNuevaAbsoluta).catch(() => {});
                    }

                    responder(res, 500, {
                        error: "No se pudo actualizar el diseño. Inténtalo nuevamente."
                    });
                    return;
                }
            }

            // Retirar o reactivar un diseño de la tienda, sin borrar su registro.
            const coincidenciaGaleriaEstado = ruta.match(
                    /^\/api\/admin\/galeria\/(\d+)\/estado$/
                    );

            if (req.method === "PATCH" && coincidenciaGaleriaEstado) {
                const id = Number(coincidenciaGaleriaEstado[1]);
                const datos = await leerCuerpo(req);

                if (typeof datos.activo !== "boolean") {
                    responder(res, 400, {error: "Estado no válido."});
                    return;
                }

                const [resultado] = await pool.execute(
                        "UPDATE galeria SET activo = ? WHERE id = ?",
                        [datos.activo ? 1 : 0, id]
                        );

                if (!resultado.affectedRows) {
                    responder(res, 404, {error: "Diseño no encontrado."});
                    return;
                }

                responder(res, 200, {
                    mensaje: datos.activo
                            ? "Diseño reactivado correctamente."
                            : "Diseño retirado correctamente."
                });
                return;
            }

            if (req.method === "GET" && ruta === "/api/admin/pedidos") {
                const estadoFiltro = url.searchParams.get("estado") || "";

                const clausulaWhere = estadoFiltro === "activos"
                        ? "WHERE p.estado IN ('pendiente', 'confirmado')"
                        : "";

                const ordenFechas = estadoFiltro === "activos"
                        ? "ORDER BY p.creado_en ASC"
                        : "ORDER BY p.creado_en DESC LIMIT 200";

                const [pedidos] = await pool.query(
                        `SELECT p.id, p.nombre_cliente, p.celular_cliente,
                                p.tipo_entrega, p.direccion_entrega,
                                p.fecha_solicitada, p.hora_solicitada,
                                p.estado, p.subtotal, p.costo_delivery, p.total,
                                p.notas, p.creado_en, p.origen,
                                GROUP_CONCAT(
                                        dp.nombre_producto, ' x', dp.cantidad
                                        ORDER BY dp.id SEPARATOR ', '
                                        ) AS productos
                         FROM pedidos p
                         LEFT JOIN detalle_pedido dp ON dp.pedido_id = p.id
                         ${clausulaWhere}
                         GROUP BY p.id, p.nombre_cliente, p.celular_cliente,
                                  p.tipo_entrega, p.direccion_entrega,
                                  p.fecha_solicitada, p.hora_solicitada,
                                  p.estado, p.subtotal, p.costo_delivery, p.total,
                                  p.notas, p.creado_en, p.origen
                         ${ordenFechas}`
                        );

                responder(res, 200, {pedidos});
                return;
            }

            // Consultar clientes y sus beneficios de fidelización.
            if (req.method === "GET" && ruta === "/api/admin/fidelizacion") {

                const busqueda = (url.searchParams.get("buscar") || "").trim();
                const condicionBusqueda = busqueda
                        ? "AND (u.nombre LIKE ? OR u.celular LIKE ?)"
                        : "";
                const parametrosBusqueda = busqueda
                        ? [`%${busqueda}%`, `%${busqueda}%`]
                        : [];

                const [clientes] = await pool.query(`
        SELECT
            u.id AS usuarioId,
            u.nombre,
            u.celular,
            COALESCE(p.comprasEntregadas, 0) AS comprasEntregadas,
            COALESCE(e.primeraCompraEntregada, 0) AS primeraCompraEntregada,
            COALESCE(e.novenaCompraEntregada, 0) AS novenaCompraEntregada,
            e.primeraCompraEntregadaEn,
            e.novenaCompraEntregadaEn

        FROM usuarios u

        LEFT JOIN (
            SELECT
                usuario_id,
                COUNT(*) AS comprasEntregadas
            FROM pedidos
            WHERE estado = 'entregado'
              AND usuario_id IS NOT NULL
            GROUP BY usuario_id
        ) p ON p.usuario_id = u.id

        LEFT JOIN (
            SELECT
                usuario_id,
                MAX(
                    CASE
                        WHEN beneficio = 'primera_compra'
                        AND entregado = 1 THEN 1
                        ELSE 0
                    END
                ) AS primeraCompraEntregada,

                MAX(
                    CASE
                        WHEN beneficio = 'novena_compra'
                        AND entregado = 1 THEN 1
                        ELSE 0
                    END
                ) AS novenaCompraEntregada,

                MAX(
                    CASE WHEN beneficio = 'primera_compra' THEN entregado_en END
                ) AS primeraCompraEntregadaEn,

                MAX(
                    CASE WHEN beneficio = 'novena_compra' THEN entregado_en END
                ) AS novenaCompraEntregadaEn

            FROM entregas_fidelizacion
            GROUP BY usuario_id
        ) e ON e.usuario_id = u.id

        WHERE u.rol = 'cliente'
          AND u.activo = TRUE
          ${condicionBusqueda}

        ORDER BY u.nombre
    `, parametrosBusqueda);

                responder(res, 200, {clientes});
                return;
            }

            // Historial de compras entregadas de un cliente específico.
            const coincidenciaHistorialCliente = ruta.match(
                    /^\/api\/admin\/fidelizacion\/(\d+)\/historial$/
                    );

            if (req.method === "GET" && coincidenciaHistorialCliente) {
                const usuarioId = Number(coincidenciaHistorialCliente[1]);

                const [[cliente]] = await pool.execute(
                        `SELECT id FROM usuarios WHERE id = ? AND rol = 'cliente'`,
                        [usuarioId]
                        );

                if (!cliente) {
                    responder(res, 404, {error: "Cliente no encontrado."});
                    return;
                }

                const [historial] = await pool.execute(
                        `SELECT id, total, fecha_entregada
                     FROM pedidos
                     WHERE usuario_id = ? AND estado = 'entregado'
                     ORDER BY fecha_entregada DESC`,
                        [usuarioId]
                        );

                responder(res, 200, {historial});
                return;
            }


// Registrar la entrega de un beneficio.
            const coincidenciaFidelizacion = ruta.match(
                    /^\/api\/admin\/fidelizacion\/(\d+)\/(primera_compra|novena_compra)\/entrega$/
                    );

            if (req.method === "PATCH" && coincidenciaFidelizacion) {

                const usuarioId = Number(coincidenciaFidelizacion[1]);
                const beneficio = coincidenciaFidelizacion[2];

                const [[cliente]] = await pool.execute(
                        `SELECT id
         FROM usuarios
         WHERE id = ?
           AND rol = 'cliente'
           AND activo = TRUE`,
                        [usuarioId]
                        );

                if (!cliente) {
                    responder(res, 404, {
                        error: "Cliente no encontrado."
                    });
                    return;
                }

                const [[resultado]] = await pool.execute(
                        `SELECT COUNT(*) AS comprasEntregadas
         FROM pedidos
         WHERE usuario_id = ?
           AND estado = 'entregado'`,
                        [usuarioId]
                        );

                const compras = Number(resultado.comprasEntregadas);

                const beneficioDisponible =
                        beneficio === "primera_compra"
                        ? compras >= 1
                        : compras >= 9;

                if (!beneficioDisponible) {
                    responder(res, 409, {
                        error: "El cliente todavía no cumple los requisitos para este beneficio."
                    });
                    return;
                }

                await pool.execute(
                        `INSERT INTO entregas_fidelizacion
            (usuario_id, beneficio, entregado, entregado_en)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
            entregado = 1,
            entregado_en = COALESCE(entregado_en, CURRENT_TIMESTAMP)`,
                        [usuarioId, beneficio]
                        );

                responder(res, 200, {
                    mensaje: "Beneficio registrado como entregado."
                });

                return;
            }

            // Cambiar estado de un pedido.
            const coincidencia = ruta.match(/^\/api\/admin\/pedidos\/(\d+)\/estado$/);

            if (req.method === "PATCH" && coincidencia) {
                const id = Number(coincidencia[1]);
                const datos = await leerCuerpo(req);
                const estados = ["pendiente", "confirmado", "entregado", "cancelado"];

                if (!estados.includes(datos.estado)) {
                    responder(res, 400, {error: "Estado no válido."});
                    return;
                }

                const [[pedidoActual]] = await pool.execute(
                        "SELECT estado FROM pedidos WHERE id = ?",
                        [id]
                        );

                if (!pedidoActual) {
                    responder(res, 404, {error: "Pedido no encontrado."});
                    return;
                }

                // Máquina de estados del Kanban: pendiente -> confirmado/cancelado,
                // confirmado -> entregado, entregado/cancelado son terminales.
                // Esto garantiza que un pedido solo llega a "entregado" pasando
                // por "confirmado" (de ahí depende la acumulación del sello).
                const transicionesValidas = {
                    pendiente: ["confirmado", "cancelado"],
                    confirmado: ["entregado"],
                    entregado: [],
                    cancelado: []
                };

                if (
                        pedidoActual.estado !== datos.estado &&
                        !transicionesValidas[pedidoActual.estado].includes(datos.estado)
                        ) {
                    responder(res, 409, {
                        error: "Esa transición de estado no está permitida."
                    });
                    return;
                }

                // Registrar la fecha real de entrega o de cancelación solo la primera vez.
                let sql = "UPDATE pedidos SET estado = ? WHERE id = ?";

                if (datos.estado === "entregado") {
                    sql = `UPDATE pedidos
                           SET estado = ?,
                               fecha_entregada = COALESCE(fecha_entregada, CURRENT_TIMESTAMP)
                           WHERE id = ?`;
                } else if (datos.estado === "cancelado") {
                    sql = `UPDATE pedidos
                           SET estado = ?,
                               cancelado_en = COALESCE(cancelado_en, CURRENT_TIMESTAMP)
                           WHERE id = ?`;
                }

                await pool.execute(sql, [datos.estado, id]);

                responder(res, 200, {mensaje: "Estado actualizado."});
                return;
            }

            // Editar la fecha/hora/lugar de recojo acordados. Solo mientras
            // el pedido no sea un estado terminal (entregado/cancelado).
            // Nunca toca `creado_en`: esa es la fecha original del pedido y
            // se conserva siempre, independientemente de cuántas veces se
            // reprograme el recojo.
            const coincidenciaEntregaPedido = ruta.match(
                    /^\/api\/admin\/pedidos\/(\d+)\/entrega$/
                    );

            if (req.method === "PATCH" && coincidenciaEntregaPedido) {
                const id = Number(coincidenciaEntregaPedido[1]);
                const datos = await leerCuerpo(req);

                const [[pedidoActual]] = await pool.execute(
                        "SELECT estado FROM pedidos WHERE id = ?",
                        [id]
                        );

                if (!pedidoActual) {
                    responder(res, 404, {error: "Pedido no encontrado."});
                    return;
                }

                if (!["pendiente", "confirmado"].includes(pedidoActual.estado)) {
                    responder(res, 409, {
                        error: "Solo se puede editar el recojo de pedidos " +
                                "pendientes o confirmados."
                    });
                    return;
                }

                const actualizarFechaHora =
                        datos.fechaSolicitada !== undefined ||
                        datos.horaSolicitada !== undefined;
                const actualizarLugar = datos.lugarRecojo !== undefined;

                if (!actualizarFechaHora && !actualizarLugar) {
                    responder(res, 400, {
                        error: "No se recibió ningún dato de recojo para actualizar."
                    });
                    return;
                }

                let fechaHoraRecojo = null;

                if (actualizarFechaHora) {
                    try {
                        fechaHoraRecojo = await validarFechaHoraRecojo(
                                datos.fechaSolicitada,
                                datos.horaSolicitada
                                );
                    } catch (error) {
                        responder(res, 400, {error: error.message});
                        return;
                    }
                }

                const lugarRecojo = actualizarLugar
                        ? String(datos.lugarRecojo || "").trim().slice(0, 255)
                        : null;

                const actualizaciones = [];
                const parametros = [];

                if (fechaHoraRecojo) {
                    actualizaciones.push("fecha_solicitada = ?", "hora_solicitada = ?");
                    parametros.push(fechaHoraRecojo.fecha, fechaHoraRecojo.hora);
                }

                if (actualizarLugar) {
                    actualizaciones.push("direccion_entrega = ?");
                    parametros.push(lugarRecojo || null);
                }

                parametros.push(id);

                await pool.execute(
                        `UPDATE pedidos SET ${actualizaciones.join(", ")} WHERE id = ?`,
                        parametros
                        );

                responder(res, 200, {
                    mensaje: "Datos de recojo actualizados correctamente.",
                    fechaSolicitada: fechaHoraRecojo ? fechaHoraRecojo.fecha : undefined,
                    horaSolicitada: fechaHoraRecojo ? fechaHoraRecojo.hora : undefined,
                    lugarRecojo: actualizarLugar ? lugarRecojo : undefined
                });
                return;
            }

            // Registrar un pedido tomado por WhatsApp, llamada o de forma
            // presencial. Nunca crea una cuenta en "usuarios" (usuario_id
            // queda NULL, igual que ya permite el esquema); siempre entra
            // como "pendiente", igual que un pedido web, para que la dueña
            // lo confirme desde el mismo Kanban.
            if (req.method === "POST" && ruta === "/api/admin/pedidos/manual") {
                const datos = await leerCuerpo(req);

                const nombreCliente = String(datos.nombreCliente || "").trim();
                const celularCliente = String(datos.celularCliente || "").trim();
                const origenesValidos = ["whatsapp", "llamada", "presencial"];
                const origen = String(datos.origen || "").trim();
                const tiposEntregaValidos = ["recojo", "delivery"];
                const tipoEntrega = String(datos.tipoEntrega || "recojo").trim();

                if (nombreCliente.length < 2 || nombreCliente.length > 100) {
                    responder(res, 400, {
                        error: "Ingresa el nombre del cliente (2 a 100 caracteres)."
                    });
                    return;
                }

                if (!/^[0-9]{6,15}$/.test(celularCliente)) {
                    responder(res, 400, {
                        error: "Ingresa un celular válido (solo números, 6 a 15 dígitos)."
                    });
                    return;
                }

                if (!origenesValidos.includes(origen)) {
                    responder(res, 400, {
                        error: "Selecciona el origen del pedido (WhatsApp, llamada o presencial)."
                    });
                    return;
                }

                if (!tiposEntregaValidos.includes(tipoEntrega)) {
                    responder(res, 400, {error: "Modalidad de recojo no válida."});
                    return;
                }

                const items = datos.items;

                if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
                    responder(res, 400, {
                        error: "Agrega al menos un producto al pedido."
                    });
                    return;
                }

                let fechaHoraAcordada = null;

                if (datos.fechaSolicitada || datos.horaSolicitada) {
                    try {
                        fechaHoraAcordada = await validarFechaHoraAcordada(
                                datos.fechaSolicitada,
                                datos.horaSolicitada
                                );
                    } catch (error) {
                        responder(res, 400, {error: error.message});
                        return;
                    }
                }

                const lugarRecojo = String(datos.lugarRecojo || "")
                        .trim()
                        .slice(0, 255);
                const notas = String(datos.notas || "").trim().slice(0, 500);

                const conexion = await pool.getConnection();

                try {
                    await conexion.beginTransaction();

                    const {detalles, subtotal} = await resolverDetallesPedido(
                            conexion,
                            items
                            );

                    const [resultadoPedido] = await conexion.execute(
                            `INSERT INTO pedidos
                            (usuario_id, nombre_cliente, celular_cliente,
                             tipo_entrega, direccion_entrega, fecha_solicitada,
                             hora_solicitada, estado, subtotal, costo_delivery,
                             total, notas, origen)
                         VALUES (NULL, ?, ?, ?, ?, ?, ?, 'pendiente', ?, 0.00, ?, ?, ?)`,
                            [
                                nombreCliente,
                                celularCliente,
                                tipoEntrega,
                                lugarRecojo || null,
                                fechaHoraAcordada ? fechaHoraAcordada.fecha : null,
                                fechaHoraAcordada ? fechaHoraAcordada.hora : null,
                                subtotal,
                                subtotal,
                                notas || null,
                                origen
                            ]
                            );

                    const pedidoId = resultadoPedido.insertId;

                    for (const detalle of detalles) {
                        await conexion.execute(
                                `INSERT INTO detalle_pedido
                                (pedido_id, producto_id, nombre_producto,
                                 presentacion, cantidad, precio_unitario, subtotal)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    pedidoId,
                                    detalle.productoId,
                                    detalle.nombre,
                                    detalle.presentacion || null,
                                    detalle.cantidad,
                                    detalle.precio,
                                    detalle.subtotal
                                ]
                                );
                    }

                    await conexion.commit();

                    responder(res, 201, {
                        mensaje: "Pedido manual registrado correctamente.",
                        pedidoId,
                        cliente: {nombre: nombreCliente, celular: celularCliente},
                        subtotal,
                        total: subtotal,
                        origen,
                        items: detalles
                    });
                    return;

                } catch (error) {
                    await conexion.rollback();

                    const errorCliente = [
                        "Producto o cantidad no válidos.",
                        "Uno de los productos ya no está disponible.",
                        "No se pudo verificar el precio de un producto.",
                        "La presentación seleccionada no es válida para este producto."
                    ].includes(error.message);

                    responder(res, errorCliente ? 400 : 500, {
                        error: errorCliente
                                ? error.message
                                : "No se pudo guardar el pedido manual. Inténtalo nuevamente."
                    });
                    return;

                } finally {
                    conexion.release();
                }
            }

            // Listado de reseñas para el panel (todas o filtradas por estado).
            if (req.method === "GET" && ruta === "/api/admin/resenas") {
                const estadoFiltro = url.searchParams.get("estado") || "";
                const estadosValidos = ["pendiente", "aprobada", "oculta"];

                const clausulaWhere = estadosValidos.includes(estadoFiltro)
                        ? "WHERE r.estado = ?"
                        : "";
                const parametros = estadosValidos.includes(estadoFiltro)
                        ? [estadoFiltro]
                        : [];

                const [resenas] = await pool.query(
                        `SELECT r.id, u.nombre AS nombreCliente, u.celular AS celularCliente,
                                pr.nombre AS nombreProducto, r.calificacion, r.comentario,
                                r.fotografia, r.estado, r.creado_en
                         FROM resenas r
                         INNER JOIN usuarios u ON u.id = r.usuario_id
                         LEFT JOIN productos pr ON pr.id = r.producto_id
                         ${clausulaWhere}
                         ORDER BY r.creado_en DESC`,
                        parametros
                        );

                responder(res, 200, {resenas});
                return;
            }

            // Aprobar y publicar, u ocultar, una reseña.
            const coincidenciaEstadoResena = ruta.match(
                    /^\/api\/admin\/resenas\/(\d+)\/estado$/
                    );

            if (req.method === "PATCH" && coincidenciaEstadoResena) {
                const id = Number(coincidenciaEstadoResena[1]);
                const datos = await leerCuerpo(req);
                const estadosPermitidos = ["aprobada", "oculta"];

                if (!estadosPermitidos.includes(datos.estado)) {
                    responder(res, 400, {error: "Estado no válido."});
                    return;
                }

                const [resultado] = await pool.execute(
                        "UPDATE resenas SET estado = ? WHERE id = ?",
                        [datos.estado, id]
                        );

                if (!resultado.affectedRows) {
                    responder(res, 404, {error: "Reseña no encontrada."});
                    return;
                }

                responder(res, 200, {
                    mensaje: datos.estado === "aprobada"
                            ? "Reseña aprobada y publicada."
                            : "Reseña ocultada."
                });
                return;
            }

            // Estadísticas de reseñas (solo sobre las aprobadas).
            if (req.method === "GET" && ruta === "/api/admin/resenas/estadisticas") {
                const [[totales]] = await pool.query(
                        `SELECT COUNT(*) AS total, COALESCE(AVG(calificacion), 0) AS promedio
                     FROM resenas
                     WHERE estado = 'aprobada'`
                        );

                const [distribucion] = await pool.query(
                        `SELECT calificacion, COUNT(*) AS total
                     FROM resenas
                     WHERE estado = 'aprobada'
                     GROUP BY calificacion
                     ORDER BY calificacion DESC`
                        );

                const [mejorValorados] = await pool.query(
                        `SELECT pr.nombre AS nombreProducto,
                                COUNT(*) AS totalResenas,
                                AVG(r.calificacion) AS promedio
                     FROM resenas r
                     INNER JOIN productos pr ON pr.id = r.producto_id
                     WHERE r.estado = 'aprobada'
                     GROUP BY pr.id, pr.nombre
                     ORDER BY promedio DESC, totalResenas DESC
                     LIMIT 5`
                        );

                responder(res, 200, {
                    total: totales.total,
                    promedio: Number(totales.promedio),
                    distribucion: distribucion.map((fila) => ({
                        calificacion: fila.calificacion,
                        total: fila.total
                    })),
                    mejorValorados: mejorValorados.map((fila) => ({
                        nombreProducto: fila.nombreProducto,
                        totalResenas: fila.totalResenas,
                        promedio: Number(fila.promedio)
                    }))
                });
                return;
            }

            // Listado de usuarios (clientes y administradoras), con filtros.
            if (req.method === "GET" && ruta === "/api/admin/usuarios") {
                const busqueda = (url.searchParams.get("buscar") || "").trim();
                const rolFiltro = url.searchParams.get("rol") || "";
                const estadoFiltro = url.searchParams.get("estado") || "";

                const condiciones = [];
                const parametros = [];

                if (busqueda) {
                    condiciones.push("(nombre LIKE ? OR celular LIKE ?)");
                    parametros.push(`%${busqueda}%`, `%${busqueda}%`);
                }

                if (rolFiltro === "admin" || rolFiltro === "cliente") {
                    condiciones.push("rol = ?");
                    parametros.push(rolFiltro);
                }

                if (estadoFiltro === "activos") {
                    condiciones.push("activo = TRUE");
                } else if (estadoFiltro === "inactivos") {
                    condiciones.push("activo = FALSE");
                }

                const clausulaWhere = condiciones.length
                        ? `WHERE ${condiciones.join(" AND ")}`
                        : "";

                // Nunca se selecciona password_hash: no debe salir del servidor.
                const [usuarios] = await pool.query(
                        `SELECT id, nombre, celular, rol, activo, creado_en
                         FROM usuarios
                         ${clausulaWhere}
                         ORDER BY creado_en DESC`,
                        parametros
                        );

                responder(res, 200, {usuarios});
                return;
            }

            // Registrar una nueva cuenta administrativa. El rol se fija aquí
            // mismo como 'admin'; nunca se acepta un rol enviado por el navegador.
            if (req.method === "POST" && ruta === "/api/admin/usuarios") {
                const datos = await leerCuerpo(req);

                const nombre = String(datos.nombre || "").trim();
                const celular = String(datos.celular || "").trim();
                const password = String(datos.password || "");

                if (nombre.length < 2 || nombre.length > 100) {
                    responder(res, 400, {
                        error: "El nombre debe tener entre 2 y 100 caracteres."
                    });
                    return;
                }

                if (!/^[0-9]{9}$/.test(celular)) {
                    responder(res, 400, {
                        error: "Ingresa un número de celular de 9 dígitos."
                    });
                    return;
                }

                if (password.length < 8 || password.length > 72) {
                    responder(res, 400, {
                        error: "La contraseña debe tener entre 8 y 72 caracteres."
                    });
                    return;
                }

                const [existentes] = await pool.execute(
                        "SELECT id FROM usuarios WHERE celular = ? LIMIT 1",
                        [celular]
                        );

                if (existentes.length > 0) {
                    responder(res, 409, {
                        error: "Este número de celular ya está registrado."
                    });
                    return;
                }

                const passwordHash = await bcrypt.hash(password, 12);

                await pool.execute(
                        `INSERT INTO usuarios
                        (nombre, celular, password_hash, rol, activo)
                     VALUES (?, ?, ?, 'admin', TRUE)`,
                        [nombre, celular, passwordHash]
                        );

                responder(res, 201, {
                    mensaje: "Cuenta administrativa registrada correctamente."
                });
                return;
            }

            // Activar o desactivar una cuenta, sin borrar su registro ni su historial.
            const coincidenciaUsuarioEstado = ruta.match(
                    /^\/api\/admin\/usuarios\/(\d+)\/estado$/
                    );

            if (req.method === "PATCH" && coincidenciaUsuarioEstado) {
                const id = Number(coincidenciaUsuarioEstado[1]);
                const datos = await leerCuerpo(req);

                if (typeof datos.activo !== "boolean") {
                    responder(res, 400, {error: "Estado no válido."});
                    return;
                }

                if (!datos.activo && id === sesion.usuarioId) {
                    responder(res, 400, {
                        error: "No puedes desactivar tu propia cuenta."
                    });
                    return;
                }

                const [[usuario]] = await pool.execute(
                        "SELECT rol FROM usuarios WHERE id = ?",
                        [id]
                        );

                if (!usuario) {
                    responder(res, 404, {error: "Usuario no encontrado."});
                    return;
                }

                if (!datos.activo && usuario.rol === "admin") {
                    const [[conteo]] = await pool.query(
                            `SELECT COUNT(*) AS total FROM usuarios
                             WHERE rol = 'admin' AND activo = TRUE`
                            );

                    if (conteo.total <= 1) {
                        responder(res, 400, {
                            error: "No puedes desactivar al último administrador activo."
                        });
                        return;
                    }
                }

                await pool.execute(
                        "UPDATE usuarios SET activo = ? WHERE id = ?",
                        [datos.activo ? 1 : 0, id]
                        );

                responder(res, 200, {
                    mensaje: datos.activo
                            ? "Cuenta reactivada correctamente."
                            : "Cuenta desactivada correctamente."
                });
                return;
            }

            // Configuración completa (incluye métodos de pago) para el panel.
            // Solo datos del negocio y horarios: metodos_pago y
            // condiciones_pedido ya no se administran desde este módulo
            // (las columnas se conservan en MySQL, pero el panel no las toca).
            if (req.method === "GET" && ruta === "/api/admin/configuracion") {
                const [[fila]] = await pool.query(
                        `SELECT datos_negocio, horarios, actualizado_en
                         FROM configuracion WHERE id = 1`
                        );

                responder(res, 200, {
                    datosNegocio: fila ? fila.datos_negocio : null,
                    horarios: fila ? fila.horarios : null,
                    actualizadoEn: fila ? fila.actualizado_en : null
                });
                return;
            }

            // Guardar una o varias secciones de configuración. La sección que
            // no se envíe no se toca (permite un botón "Guardar" por formulario).
            if (req.method === "PUT" && ruta === "/api/admin/configuracion") {
                const datos = await leerCuerpo(req);

                const actualizaciones = [];
                const parametros = [];

                try {
                    if (datos.datosNegocio !== undefined) {
                        actualizaciones.push("datos_negocio = ?");
                        parametros.push(
                                JSON.stringify(validarDatosNegocio(datos.datosNegocio))
                                );
                    }

                    if (datos.horarios !== undefined) {
                        actualizaciones.push("horarios = ?");
                        parametros.push(
                                JSON.stringify(validarHorarios(datos.horarios))
                                );
                    }
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                if (!actualizaciones.length) {
                    responder(res, 400, {
                        error: "No se recibió ninguna sección para actualizar."
                    });
                    return;
                }

                await pool.execute(
                        `UPDATE configuracion SET ${actualizaciones.join(", ")} WHERE id = 1`,
                        parametros
                        );

                responder(res, 200, {mensaje: "Configuración actualizada correctamente."});
                return;
            }

            // Resumen mensual del calendario: cuántos pedidos confirmados
            // hay en cada fecha. Nunca pendientes/cancelados/entregados.
            if (req.method === "GET" && ruta === "/api/admin/calendario/resumen") {
                const ahora = new Date();
                const mes = Number(url.searchParams.get("mes")) || ahora.getMonth() + 1;
                const anio = Number(url.searchParams.get("anio")) || ahora.getFullYear();

                if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
                    responder(res, 400, {error: "Mes no válido."});
                    return;
                }

                if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) {
                    responder(res, 400, {error: "Año no válido."});
                    return;
                }

                const [filas] = await pool.execute(
                        `SELECT DATE_FORMAT(fecha_solicitada, '%Y-%m-%d') AS fecha,
                                COUNT(*) AS cantidad
                         FROM pedidos
                         WHERE estado = 'confirmado'
                           AND fecha_solicitada IS NOT NULL
                           AND YEAR(fecha_solicitada) = ?
                           AND MONTH(fecha_solicitada) = ?
                         GROUP BY fecha_solicitada
                         ORDER BY fecha_solicitada`,
                        [anio, mes]
                        );

                responder(res, 200, {
                    mes,
                    anio,
                    dias: filas.map((fila) => ({
                        fecha: fila.fecha,
                        cantidad: Number(fila.cantidad)
                    }))
                });
                return;
            }

            // Pedidos confirmados de una fecha específica.
            if (req.method === "GET" && ruta === "/api/admin/calendario/dia") {
                const fecha = url.searchParams.get("fecha") || "";

                if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
                    responder(res, 400, {error: "Fecha no válida."});
                    return;
                }

                const [pedidos] = await pool.execute(
                        `SELECT p.id, p.nombre_cliente, p.hora_solicitada,
                                COALESCE(SUM(dp.cantidad), 0) AS cantidadItems,
                                GROUP_CONCAT(
                                        dp.nombre_producto, ' x', dp.cantidad
                                        ORDER BY dp.id SEPARATOR ', '
                                        ) AS productos
                         FROM pedidos p
                         LEFT JOIN detalle_pedido dp ON dp.pedido_id = p.id
                         WHERE p.estado = 'confirmado' AND p.fecha_solicitada = ?
                         GROUP BY p.id, p.nombre_cliente, p.hora_solicitada
                         ORDER BY p.hora_solicitada ASC`,
                        [fecha]
                        );

                responder(res, 200, {
                    fecha,
                    pedidos: pedidos.map((pedido) => ({
                        id: pedido.id,
                        nombreCliente: pedido.nombre_cliente,
                        horaSolicitada: pedido.hora_solicitada,
                        cantidadItems: Number(pedido.cantidadItems),
                        productos: pedido.productos || "Sin productos registrados"
                    }))
                });
                return;
            }

            // Detalle completo de un pedido: cliente, productos, adicionales,
            // historial de pagos y todos los totales calculados en el
            // servidor (nunca se confía en nada enviado por el navegador).
            const coincidenciaDetalleCompleto = ruta.match(
                    /^\/api\/admin\/pedidos\/(\d+)\/detalle-completo$/
                    );

            if (req.method === "GET" && coincidenciaDetalleCompleto) {
                const id = Number(coincidenciaDetalleCompleto[1]);

                const [[pedido]] = await pool.execute(
                        `SELECT id, nombre_cliente, celular_cliente, estado,
                                DATE_FORMAT(fecha_solicitada, '%Y-%m-%d') AS fecha_solicitada,
                                hora_solicitada, direccion_entrega, notas,
                                subtotal, total, creado_en, origen
                         FROM pedidos WHERE id = ?`,
                        [id]
                        );

                if (!pedido) {
                    responder(res, 404, {error: "Pedido no encontrado."});
                    return;
                }

                const [productos] = await pool.execute(
                        `SELECT nombre_producto, presentacion, cantidad,
                                precio_unitario, subtotal
                         FROM detalle_pedido
                         WHERE pedido_id = ?
                         ORDER BY id`,
                        [id]
                        );

                const [adicionales] = await pool.execute(
                        `SELECT id, nombre, descripcion, precio, activo, creado_en
                         FROM pedido_adicionales
                         WHERE pedido_id = ?
                         ORDER BY creado_en DESC`,
                        [id]
                        );

                const [pagos] = await pool.execute(
                        `SELECT id, monto, metodo_pago, referencia, fecha_pago
                         FROM movimientos_pago
                         WHERE pedido_id = ?
                         ORDER BY fecha_pago ASC, id ASC`,
                        [id]
                        );

                const subtotalProductos = Number(pedido.subtotal);

                const totalAdicionalesActivos = adicionales
                        .filter((adicional) => adicional.activo)
                        .reduce((suma, adicional) => suma + Number(adicional.precio), 0);

                const totalGeneral = Math.round(
                        (subtotalProductos + totalAdicionalesActivos) * 100
                        ) / 100;

                const totalPagado = Math.round(
                        pagos.reduce((suma, pago) => suma + Number(pago.monto), 0) * 100
                        ) / 100;

                const saldoPendiente = Math.max(
                        0,
                        Math.round((totalGeneral - totalPagado) * 100) / 100
                        );

                const estadoPago = totalPagado <= 0
                        ? "pendiente"
                        : saldoPendiente <= 0
                                ? "pagado"
                                : "parcial";

                responder(res, 200, {
                    pedido: {
                        id: pedido.id,
                        nombreCliente: pedido.nombre_cliente,
                        celularCliente: pedido.celular_cliente,
                        estado: pedido.estado,
                        fechaCreacion: pedido.creado_en,
                        fechaSolicitada: pedido.fecha_solicitada,
                        horaSolicitada: pedido.hora_solicitada,
                        lugarRecojo: pedido.direccion_entrega,
                        notas: pedido.notas,
                        origen: pedido.origen
                    },
                    productos,
                    adicionales,
                    pagos,
                    totales: {
                        subtotalProductos,
                        totalAdicionalesActivos: Math.round(totalAdicionalesActivos * 100) / 100,
                        totalGeneral,
                        totalPagado,
                        saldoPendiente,
                        estadoPago
                    }
                });
                return;
            }

            // Registrar un adicional cotizado por WhatsApp. Nunca se mezcla
            // con detalle_pedido ni se permite si el pedido ya fue entregado
            // (conserva intacto lo que realmente se entregó y cobró).
            const coincidenciaCrearAdicional = ruta.match(
                    /^\/api\/admin\/pedidos\/(\d+)\/adicionales$/
                    );

            if (req.method === "POST" && coincidenciaCrearAdicional) {
                const pedidoId = Number(coincidenciaCrearAdicional[1]);

                const [[pedido]] = await pool.execute(
                        "SELECT estado FROM pedidos WHERE id = ?",
                        [pedidoId]
                        );

                if (!pedido) {
                    responder(res, 404, {error: "Pedido no encontrado."});
                    return;
                }

                if (pedido.estado === "entregado") {
                    responder(res, 409, {
                        error: "No se pueden agregar adicionales a un pedido ya entregado."
                    });
                    return;
                }

                const datos = await leerCuerpo(req);
                let adicional;

                try {
                    adicional = validarAdicionalPedido(datos);
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                await pool.execute(
                        `INSERT INTO pedido_adicionales
                        (pedido_id, nombre, descripcion, precio, activo)
                     VALUES (?, ?, ?, ?, TRUE)`,
                        [pedidoId, adicional.nombre, adicional.descripcion, adicional.precio]
                        );

                responder(res, 201, {mensaje: "Adicional registrado correctamente."});
                return;
            }

            // Editar un adicional existente (mismo bloqueo por pedido entregado).
            const coincidenciaEditarAdicional = ruta.match(
                    /^\/api\/admin\/pedidos\/(\d+)\/adicionales\/(\d+)$/
                    );

            if (req.method === "PUT" && coincidenciaEditarAdicional) {
                const pedidoId = Number(coincidenciaEditarAdicional[1]);
                const adicionalId = Number(coincidenciaEditarAdicional[2]);

                const [[pedido]] = await pool.execute(
                        "SELECT estado FROM pedidos WHERE id = ?",
                        [pedidoId]
                        );

                if (!pedido) {
                    responder(res, 404, {error: "Pedido no encontrado."});
                    return;
                }

                if (pedido.estado === "entregado") {
                    responder(res, 409, {
                        error: "No se pueden editar adicionales de un pedido ya entregado."
                    });
                    return;
                }

                const [[adicionalActual]] = await pool.execute(
                        "SELECT id FROM pedido_adicionales WHERE id = ? AND pedido_id = ?",
                        [adicionalId, pedidoId]
                        );

                if (!adicionalActual) {
                    responder(res, 404, {error: "Adicional no encontrado."});
                    return;
                }

                const datos = await leerCuerpo(req);
                let adicional;

                try {
                    adicional = validarAdicionalPedido(datos);
                } catch (error) {
                    responder(res, 400, {error: error.message});
                    return;
                }

                await pool.execute(
                        `UPDATE pedido_adicionales
                         SET nombre = ?, descripcion = ?, precio = ?
                         WHERE id = ?`,
                        [adicional.nombre, adicional.descripcion, adicional.precio, adicionalId]
                        );

                responder(res, 200, {mensaje: "Adicional actualizado correctamente."});
                return;
            }

            // Desactivar/reactivar un adicional, sin borrar su registro.
            const coincidenciaEstadoAdicional = ruta.match(
                    /^\/api\/admin\/pedidos\/(\d+)\/adicionales\/(\d+)\/estado$/
                    );

            if (req.method === "PATCH" && coincidenciaEstadoAdicional) {
                const pedidoId = Number(coincidenciaEstadoAdicional[1]);
                const adicionalId = Number(coincidenciaEstadoAdicional[2]);

                const [[pedido]] = await pool.execute(
                        "SELECT estado FROM pedidos WHERE id = ?",
                        [pedidoId]
                        );

                if (!pedido) {
                    responder(res, 404, {error: "Pedido no encontrado."});
                    return;
                }

                if (pedido.estado === "entregado") {
                    responder(res, 409, {
                        error: "No se pueden modificar adicionales de un pedido ya entregado."
                    });
                    return;
                }

                const datos = await leerCuerpo(req);

                if (typeof datos.activo !== "boolean") {
                    responder(res, 400, {error: "Estado no válido."});
                    return;
                }

                const [resultado] = await pool.execute(
                        `UPDATE pedido_adicionales SET activo = ?
                         WHERE id = ? AND pedido_id = ?`,
                        [datos.activo ? 1 : 0, adicionalId, pedidoId]
                        );

                if (!resultado.affectedRows) {
                    responder(res, 404, {error: "Adicional no encontrado."});
                    return;
                }

                responder(res, 200, {
                    mensaje: datos.activo
                            ? "Adicional reactivado correctamente."
                            : "Adicional desactivado correctamente."
                });
                return;
            }

            // Registrar un movimiento de pago. Se permite incluso con el
            // pedido ya entregado (el pago final suele registrarse justo al
            // momento de la entrega). Nunca se edita ni se borra un pago.
            const coincidenciaCrearPago = ruta.match(
                    /^\/api\/admin\/pedidos\/(\d+)\/pagos$/
                    );

            if (req.method === "POST" && coincidenciaCrearPago) {
                const pedidoId = Number(coincidenciaCrearPago[1]);
                const datos = await leerCuerpo(req);

                const monto = Number(datos.monto);
                const metodoPago = String(datos.metodoPago || "").trim();
                const referencia = String(datos.referencia || "").trim();
                const metodosValidos = ["yape", "transferencia", "efectivo", "otro"];
                const fechaPago = /^\d{4}-\d{2}-\d{2}$/.test(String(datos.fecha || ""))
                        ? datos.fecha
                        : null;

                if (!Number.isFinite(monto) || monto <= 0 || monto > 100000) {
                    responder(res, 400, {error: "Ingresa un monto válido."});
                    return;
                }

                if (!metodosValidos.includes(metodoPago)) {
                    responder(res, 400, {error: "Selecciona un método de pago válido."});
                    return;
                }

                if (referencia.length > 255) {
                    responder(res, 400, {error: "La referencia es demasiado larga."});
                    return;
                }

                const conexion = await pool.getConnection();

                try {
                    await conexion.beginTransaction();

                    // Bloquea la fila del pedido: si llegan dos solicitudes de
                    // pago al mismo tiempo, la segunda espera a que la primera
                    // termine y recalcula el saldo ya actualizado.
                    const [[pedido]] = await conexion.execute(
                            "SELECT id, subtotal FROM pedidos WHERE id = ? FOR UPDATE",
                            [pedidoId]
                            );

                    if (!pedido) {
                        await conexion.rollback();
                        responder(res, 404, {error: "Pedido no encontrado."});
                        return;
                    }

                    // Evitar pagos duplicados: mismo monto, método y
                    // referencia registrados hace unos segundos (doble clic
                    // o solicitud repetida por una red lenta).
                    const [[duplicado]] = await conexion.execute(
                            `SELECT COUNT(*) AS total FROM movimientos_pago
                             WHERE pedido_id = ? AND monto = ? AND metodo_pago = ?
                               AND referencia <=> ?
                               AND fecha_pago >= (NOW() - INTERVAL 5 SECOND)`,
                            [pedidoId, monto, metodoPago, referencia || null]
                            );

                    if (Number(duplicado.total) > 0) {
                        await conexion.rollback();
                        responder(res, 409, {
                            error: "Este pago ya se registró hace unos segundos. " +
                                    "Verifica el historial antes de repetirlo."
                        });
                        return;
                    }

                    const [[adicionalesSuma]] = await conexion.execute(
                            `SELECT COALESCE(SUM(precio), 0) AS total
                             FROM pedido_adicionales
                             WHERE pedido_id = ? AND activo = TRUE`,
                            [pedidoId]
                            );

                    const [[pagosSuma]] = await conexion.execute(
                            `SELECT COALESCE(SUM(monto), 0) AS total
                             FROM movimientos_pago WHERE pedido_id = ?`,
                            [pedidoId]
                            );

                    const totalGeneral = Math.round(
                            (Number(pedido.subtotal) + Number(adicionalesSuma.total)) * 100
                            ) / 100;

                    const saldoActual = Math.round(
                            (totalGeneral - Number(pagosSuma.total)) * 100
                            ) / 100;

                    // Pequeño margen de centavos por redondeo acumulado.
                    if (monto > saldoActual + 0.01) {
                        await conexion.rollback();
                        responder(res, 400, {
                            error: `El monto supera el saldo pendiente ` +
                                    `(S/ ${saldoActual.toFixed(2)}).`
                        });
                        return;
                    }

                    if (fechaPago) {
                        await conexion.execute(
                                `INSERT INTO movimientos_pago
                                (pedido_id, monto, metodo_pago, referencia, fecha_pago)
                             VALUES (?, ?, ?, ?, ?)`,
                                [pedidoId, monto, metodoPago, referencia || null, fechaPago]
                                );
                    } else {
                        await conexion.execute(
                                `INSERT INTO movimientos_pago
                                (pedido_id, monto, metodo_pago, referencia)
                             VALUES (?, ?, ?, ?)`,
                                [pedidoId, monto, metodoPago, referencia || null]
                                );
                    }

                    await conexion.commit();

                    const nuevoSaldo = Math.max(
                            0,
                            Math.round((saldoActual - monto) * 100) / 100
                            );

                    responder(res, 201, {
                        mensaje: "Pago registrado correctamente.",
                        saldoPendiente: nuevoSaldo
                    });
                    return;
                } catch (error) {
                    await conexion.rollback();
                    responder(res, 500, {
                        error: "No se pudo registrar el pago. Inténtalo nuevamente."
                    });
                    return;
                } finally {
                    conexion.release();
                }
            }

            responder(res, 404, {error: "Ruta administrativa no encontrada."});
            return;
        }

        // Servir las páginas y recursos públicos del proyecto.
        if (req.method === "GET" || req.method === "HEAD") {
            enviarArchivo(req, res, ruta);
            return;
        }

        responder(res, 405, {error: "Método no permitido."});
    } catch (error) {
        console.error("Error del servidor:", error.message);

        if (!res.headersSent) {
            responder(res, 500, {
                error: "Ocurrió un error interno del servidor."
            });
        }
    }
});

servidor.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
