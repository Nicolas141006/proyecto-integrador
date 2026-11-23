const mensaje = document.getElementById("mensaje");

const titulos = {
    inicio: "Panel administrativo",
    productos: "Productos",
    pedidos: "Pedidos",
    fidelizacion: "Fidelización",
    resenas: "Reseñas",
    galeria: "Galería",
    usuarios: "Usuarios",
    configuracion: "Configuración",
    calendario: "Calendario delivery"
};

const descripciones = {
    fidelizacion: "Aquí administraremos los sellos y beneficios para los clientes.",
    resenas: "Aquí podremos consultar y gestionar las reseñas de los clientes.",
    galeria: "Aquí administraremos las fotografías de los trabajos de la pastelería.",
    usuarios: "Aquí gestionaremos las cuentas y los permisos autorizados.",
    configuracion: "Aquí podrás administrar los datos y las preferencias de la pastelería.",
    calendario: "Aquí organizaremos las fechas solicitadas y la planificación de las entregas."
};

const iconos = {
    fidelizacion: "fa-heart",
    resenas: "fa-star",
    galeria: "fa-images",
    usuarios: "fa-user-gear",
    configuracion: "fa-gear",
    calendario: "fa-calendar-days"
};

const nombresCategoriasProducto = {
    "tortas-clasicas": "Tortas clásicas",
    "postres": "Postres",
    "bocaditos": "Bocaditos",
    "kekes-caseros": "Kekes caseros"
};

const nombresCategoriasGaleria = {
    cumpleanos: "Cumpleaños",
    infantiles: "Infantiles",
    eventos: "Eventos especiales",
    elegantes: "Diseños elegantes"
};

const nombresRolUsuario = {
    admin: "Administradora",
    cliente: "Cliente"
};

// Celular de la administradora que tiene la sesión abierta, para no
// mostrarle un botón de "Desactivar" sobre su propia cuenta.
let celularSesionActual = null;

async function api(ruta, opciones = {}) {
    const respuesta = await fetch(ruta, {
        credentials: "same-origin",
        ...opciones,
        headers: {
            ...(opciones.headers || {})
        }
    });

    const datos = await respuesta.json();

    if (respuesta.status === 401) {
        window.location.href = "/html/login.html";
        throw new Error("Tu sesión terminó. Inicia sesión nuevamente.");
    }

    if (!respuesta.ok) {
        throw new Error(datos.error || "No se pudo completar la solicitud.");
    }

    return datos;
}

function elemento(tag, texto, clase) {
    const nodo = document.createElement(tag);
    nodo.textContent = texto ?? "";

    if (clase)
        nodo.className = clase;

    return nodo;
}

function formatoPrecio(valor) {
    return "S/ " + Number(valor || 0).toFixed(2);
}

function formatoFecha(valor) {
    if (!valor)
        return "—";

    const texto = String(valor);

    // Las fechas "solo fecha" (columnas DATE, ej. "2026-11-27") se arman con
    // componentes locales (año, mes, día) en vez de new Date(texto): ese
    // constructor interpreta un texto así como medianoche UTC, y al
    // mostrarla en la hora local del navegador puede correrse un día hacia
    // atrás (el desfase que se detectó al seleccionar fechas en el
    // calendario). Para fechas con hora incluida, el comportamiento anterior
    // ya era correcto y se conserva igual.
    const soloFecha = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);

    const fecha = soloFecha
            ? new Date(Number(soloFecha[1]), Number(soloFecha[2]) - 1, Number(soloFecha[3]))
            : new Date(texto);

    if (Number.isNaN(fecha.getTime())) {
        return texto.slice(0, 10);
    }

    return fecha.toLocaleDateString("es-PE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

// Fecha de "hoy" según la zona horaria de Perú (America/Lima, UTC-5 fijo,
// sin horario de verano), nunca UTC: toISOString() usaría el día en UTC y
// marcaría el día siguiente como "hoy" desde cerca de las 7pm hora local.
function fechaLocalPeruISO(fecha = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(fecha);
}

function formatoHora(valor) {
    if (!valor)
        return "—";

    return String(valor).slice(0, 5);
}

// Extrae "YYYY-MM-DD" de cualquier valor de fecha (texto plano o con hora)
// sin pasar por Date(), para prellenar <input type="date"> sin riesgo de
// desfase por huso horario.
function extraerFechaISO(valor) {
    if (!valor)
        return "";

    const coincidencia = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor));
    return coincidencia ? coincidencia[1] : "";
}

function crearTabla(columnas, filas) {
    const contenedor = document.createElement("div");
    contenedor.className = "table-wrap";

    if (!filas.length) {
        const vacio = document.createElement("div");
        vacio.className = "empty-state";

        const icono = document.createElement("i");
        icono.className = "fa-regular fa-folder-open";

        vacio.append(
                icono,
                document.createTextNode("Todavía no hay registros.")
                );

        contenedor.append(vacio);
        return contenedor;
    }

    const tabla = document.createElement("table");
    tabla.className = "admin-table";

    const thead = document.createElement("thead");
    const filaCabecera = document.createElement("tr");

    columnas.forEach((columna) => {
        filaCabecera.append(elemento("th", columna.label));
    });

    thead.append(filaCabecera);
    tabla.append(thead);

    const tbody = document.createElement("tbody");

    filas.forEach((datos) => {
        const fila = document.createElement("tr");

        columnas.forEach((columna) => {
            const celda = document.createElement("td");
            const valor = datos[columna.key];

            if (columna.key === "estado") {
                const estado = elemento(
                        "span",
                        valor || "pendiente",
                        "status " + String(valor || "pendiente").replaceAll("_", "-")
                        );
                celda.append(estado);
            } else if (columna.render) {
                columna.render(celda, datos);
            } else {
                celda.textContent = valor ?? "—";
            }

            fila.append(celda);
        });

        tbody.append(fila);
    });

    tabla.append(tbody);
    contenedor.append(tabla);

    return contenedor;
}

function crearTablaPedidos(pedidos) {
    const columnas = [
        {key: "id", label: "N.º pedido"},
        {key: "nombre_cliente", label: "Cliente"},
        {key: "celular_cliente", label: "Celular"},
        {
            key: "total",
            label: "Total",
            render(celda, pedido) {
                celda.textContent = formatoPrecio(pedido.total);
            }
        },
        {
            key: "estado",
            label: "Estado",
            render(celda, pedido) {
                const estado = elemento(
                        "span",
                        pedido.estado,
                        "status " + String(pedido.estado || "pendiente").replaceAll("_", "-")
                        );
                celda.append(estado);
            }
        },
        {
            key: "fecha",
            label: "Fecha",
            render(celda, pedido) {
                celda.textContent = formatoFecha(pedido.creado_en);
            }
        }
    ];

    return crearTabla(columnas, pedidos);
}

let productosCargados = [];

function construirQueryProductos() {
    const categoria = document.getElementById("filtroCategoriaProducto").value;
    const estado = document.getElementById("filtroEstadoProducto").value;
    const parametros = new URLSearchParams();

    if (categoria)
        parametros.set("categoria", categoria);

    if (estado)
        parametros.set("estado", estado);

    const query = parametros.toString();
    return query ? `?${query}` : "";
}

async function cargarProductos() {
    const datos = await api("/api/admin/productos" + construirQueryProductos());
    productosCargados = datos.productos;

    const columnas = [
        {key: "nombre", label: "Producto"},
        {
            key: "categoria",
            label: "Categoría",
            render(celda, producto) {
                celda.textContent =
                        nombresCategoriasProducto[producto.categoria] || producto.categoria;
            }
        },
        {
            key: "precio",
            label: "Precio",
            render(celda, producto) {
                celda.textContent = formatoPrecio(producto.precio);
            }
        },
        {
            key: "disponible",
            label: "Disponibilidad",
            render(celda, producto) {
                celda.append(elemento(
                        "span",
                        producto.disponible ? "Disponible" : "No disponible",
                        "status " + (producto.disponible ? "entregado" : "cancelado")
                        ));
            }
        },
        {
            key: "acciones",
            label: "Acciones",
            render(celda, producto) {
                const botonEditar = elemento("button", "Editar", "fidelizacion-button");
                botonEditar.type = "button";

                botonEditar.addEventListener("click", () => {
                    abrirFormularioProducto(producto);
                });

                const botonEstado = elemento(
                        "button",
                        producto.disponible ? "Dar de baja" : "Reactivar",
                        "fidelizacion-button " +
                        (producto.disponible
                                ? "fidelizacion-button--baja"
                                : "fidelizacion-button--reactivar")
                        );

                botonEstado.type = "button";

                botonEstado.addEventListener("click", () => {
                    cambiarEstadoProducto(producto, botonEstado);
                });

                celda.append(botonEditar, botonEstado);
            }
        }
    ];

    document.getElementById("tablaProductos").replaceChildren(
            crearTabla(columnas, productosCargados)
            );
}

let presentacionesNoEditables = false;
let disponibleOriginal = null;

function crearFilaDinamica(valorClave, valorDato, tipoDato, textoAria) {
    const fila = document.createElement("div");
    fila.className = "admin-dynamic-row";

    const campoClave = document.createElement("input");
    campoClave.type = "text";
    campoClave.maxLength = 60;
    campoClave.className = "admin-dynamic-row__clave";
    campoClave.value = valorClave;

    const campoDato = document.createElement("input");
    campoDato.type = tipoDato;

    if (tipoDato === "number") {
        campoDato.min = "0";
        campoDato.step = "0.01";
    } else {
        campoDato.maxLength = 300;
    }

    campoDato.className = "admin-dynamic-row__valor";
    campoDato.value = valorDato;

    const botonQuitar = document.createElement("button");
    botonQuitar.type = "button";
    botonQuitar.className = "admin-dynamic-row__quitar";
    botonQuitar.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    botonQuitar.setAttribute("aria-label", textoAria);
    botonQuitar.addEventListener("click", () => fila.remove());

    fila.append(campoClave, campoDato, botonQuitar);
    return fila;
}

function agregarFilaDetalle(clave = "", valor = "") {
    const fila = crearFilaDinamica(clave, valor, "text", "Quitar característica");
    fila.querySelector(".admin-dynamic-row__clave").placeholder = "Clave (ej. Sabor)";
    fila.querySelector(".admin-dynamic-row__valor").placeholder = "Valor (ej. Chocolate)";
    document.getElementById("filasDetalles").append(fila);
}

function agregarFilaPresentacion(etiqueta = "", precio = "") {
    const fila = crearFilaDinamica(etiqueta, precio, "number", "Quitar presentación");
    fila.querySelector(".admin-dynamic-row__clave").placeholder = "Etiqueta (ej. 1 kg)";
    fila.querySelector(".admin-dynamic-row__valor").placeholder = "Precio (S/)";
    document.getElementById("filasPresentaciones").append(fila);
}

function abrirFormularioProducto(producto = null) {
    const formulario = document.getElementById("formularioProducto");
    formulario.reset();

    document.getElementById("errorFormularioProducto").textContent = "";
    document.getElementById("campoProductoId").value = producto ? producto.id : "";

    document.getElementById("tituloFormularioProducto").textContent =
            producto ? "Editar producto" : "Nuevo producto";

    document.getElementById("campoNombre").value = producto ? producto.nombre : "";
    document.getElementById("campoCategoria").value = producto ? producto.categoria : "";
    document.getElementById("campoPrecio").value = producto ? producto.precio : "";
    document.getElementById("campoUnidadVenta").value = producto?.unidad_venta || "";
    document.getElementById("campoUnidadesPorCaja").value = producto?.unidades_por_caja || "";
    document.getElementById("campoPedidoMinimo").value = producto?.pedido_minimo || "";
    document.getElementById("campoAnticipacion").value = producto?.anticipacion || "";
    document.getElementById("campoDescripcion").value = producto?.descripcion || "";

    disponibleOriginal = producto ? Boolean(producto.disponible) : null;
    document.getElementById("campoDisponible").checked =
            producto ? Boolean(producto.disponible) : true;

    document.getElementById("filasDetalles").replaceChildren();
    Object.entries(producto?.detalles || {}).forEach(([clave, valor]) => {
        agregarFilaDetalle(clave, valor);
    });

    const presentacionesActuales = producto?.presentaciones;
    const esFormaSinPrecioIndividual = Boolean(
            presentacionesActuales &&
            typeof presentacionesActuales === "object" &&
            Array.isArray(presentacionesActuales.opciones)
            );

    presentacionesNoEditables = esFormaSinPrecioIndividual;
    document.getElementById("notaPresentacionesNoEditable").hidden =
            !esFormaSinPrecioIndividual;
    document.getElementById("botonAgregarPresentacion").hidden =
            esFormaSinPrecioIndividual;

    document.getElementById("filasPresentaciones").replaceChildren();

    if (!esFormaSinPrecioIndividual) {
        Object.entries(presentacionesActuales || {}).forEach(([etiqueta, precio]) => {
            agregarFilaPresentacion(etiqueta, precio);
        });
    }

    const campoImagen = document.getElementById("campoImagen");
    campoImagen.value = "";
    campoImagen.required = !producto;

    document.getElementById("etiquetaImagenProducto").textContent = producto
            ? "Imagen principal (deja vacío para conservar la actual)"
            : "Imagen principal (obligatoria)";

    const vistaPreviaContenedor = document.getElementById("vistaPreviaImagenContenedor");
    const vistaPrevia = document.getElementById("vistaPreviaImagen");

    if (producto && producto.imagen) {
        vistaPrevia.src = "../fotos/" + producto.imagen;
        vistaPreviaContenedor.hidden = false;
    } else {
        vistaPrevia.src = "";
        vistaPreviaContenedor.hidden = true;
    }

    const seccion = document.getElementById("seccionFormularioProducto");
    seccion.hidden = false;
    seccion.scrollIntoView({behavior: "smooth", block: "start"});
}

function cerrarFormularioProducto() {
    document.getElementById("seccionFormularioProducto").hidden = true;
    document.getElementById("formularioProducto").reset();
    document.getElementById("filasDetalles").replaceChildren();
    document.getElementById("filasPresentaciones").replaceChildren();
}

async function guardarProducto(event) {
    event.preventDefault();

    const id = document.getElementById("campoProductoId").value;
    const boton = document.getElementById("botonGuardarProducto");
    const errorTexto = document.getElementById("errorFormularioProducto");

    errorTexto.textContent = "";

    const datosFormulario = new FormData();
    datosFormulario.set("nombre", document.getElementById("campoNombre").value.trim());
    datosFormulario.set("categoria", document.getElementById("campoCategoria").value);
    datosFormulario.set("precio", document.getElementById("campoPrecio").value);
    datosFormulario.set("unidad_venta", document.getElementById("campoUnidadVenta").value.trim());
    datosFormulario.set("unidades_por_caja", document.getElementById("campoUnidadesPorCaja").value);
    datosFormulario.set("pedido_minimo", document.getElementById("campoPedidoMinimo").value);
    datosFormulario.set("anticipacion", document.getElementById("campoAnticipacion").value.trim());
    datosFormulario.set("descripcion", document.getElementById("campoDescripcion").value.trim());

    const detallesObjeto = {};

    document.querySelectorAll("#filasDetalles .admin-dynamic-row").forEach((fila) => {
        const clave = fila.querySelector(".admin-dynamic-row__clave").value.trim();
        const valor = fila.querySelector(".admin-dynamic-row__valor").value.trim();

        if (clave) {
            detallesObjeto[clave] = valor;
        }
    });

    datosFormulario.set("detalles", JSON.stringify(detallesObjeto));

    if (!presentacionesNoEditables) {
        const presentacionesObjeto = {};

        document.querySelectorAll("#filasPresentaciones .admin-dynamic-row").forEach((fila) => {
            const etiqueta = fila.querySelector(".admin-dynamic-row__clave").value.trim();
            const precio = fila.querySelector(".admin-dynamic-row__valor").value.trim();

            if (etiqueta && precio !== "") {
                presentacionesObjeto[etiqueta] = precio;
            }
        });

        datosFormulario.set("presentaciones", JSON.stringify(presentacionesObjeto));
    }

    const archivo = document.getElementById("campoImagen").files[0];

    if (archivo) {
        datosFormulario.set("imagen", archivo);
    }

    const disponibleNuevo = document.getElementById("campoDisponible").checked;

    if (!id) {
        datosFormulario.set("disponible", disponibleNuevo ? "1" : "0");
    }

    boton.disabled = true;

    try {
        if (id) {
            await api(`/api/admin/productos/${id}`, {
                method: "PUT",
                body: datosFormulario
            });

            if (disponibleOriginal !== null && disponibleNuevo !== disponibleOriginal) {
                await api(`/api/admin/productos/${id}/estado`, {
                    method: "PATCH",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({disponible: disponibleNuevo})
                });
            }

            mensaje.textContent = "Producto actualizado correctamente.";
        } else {
            await api("/api/admin/productos", {
                method: "POST",
                body: datosFormulario
            });

            mensaje.textContent = "Producto registrado correctamente.";
        }

        cerrarFormularioProducto();
        await cargarProductos();
        await cargarResumen();
    } catch (error) {
        errorTexto.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
}

async function cambiarEstadoProducto(producto, boton) {
    const activar = !producto.disponible;

    const confirmacion = confirm(
            activar
            ? `¿Confirmas reactivar "${producto.nombre}"?`
            : `¿Confirmas dar de baja "${producto.nombre}"? Dejará de mostrarse en la tienda.`
            );

    if (!confirmacion)
        return;

    boton.disabled = true;

    try {
        const datos = await api(`/api/admin/productos/${producto.id}/estado`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({disponible: activar})
        });

        mensaje.textContent = datos.mensaje;
        await cargarProductos();
        await cargarResumen();
    } catch (error) {
        mensaje.textContent = error.message;
        boton.disabled = false;
    }
}

function construirQueryGaleria() {
    const categoria = document.getElementById("filtroCategoriaGaleria").value;
    const estado = document.getElementById("filtroEstadoGaleria").value;
    const parametros = new URLSearchParams();

    if (categoria)
        parametros.set("categoria", categoria);

    if (estado)
        parametros.set("estado", estado);

    const query = parametros.toString();
    return query ? `?${query}` : "";
}

let disenosGaleriaCargados = [];
let activoOriginalGaleria = null;

async function cargarGaleria() {
    const contenedor = document.getElementById("tablaGaleria");
    let datos;

    try {
        datos = await api("/api/admin/galeria" + construirQueryGaleria());
    } catch (error) {
        contenedor.textContent = error.message;
        return;
    }

    disenosGaleriaCargados = datos.galeria;

    const columnas = [
        {
            key: "imagen",
            label: "Fotografía",
            render(celda, diseno) {
                const miniatura = document.createElement("img");
                miniatura.src = "../fotos/" + diseno.imagen;
                miniatura.alt = diseno.nombre;
                miniatura.className = "admin-thumb";
                celda.append(miniatura);
            }
        },
        {key: "nombre", label: "Nombre"},
        {
            key: "categoria",
            label: "Clasificación",
            render(celda, diseno) {
                celda.textContent =
                        nombresCategoriasGaleria[diseno.categoria] || diseno.categoria;
            }
        },
        {
            key: "activo",
            label: "Estado",
            render(celda, diseno) {
                celda.append(elemento(
                        "span",
                        diseno.activo ? "Activo" : "Retirado",
                        "status " + (diseno.activo ? "entregado" : "cancelado")
                        ));
            }
        },
        {
            key: "acciones",
            label: "Acciones",
            render(celda, diseno) {
                const botonEditar = elemento("button", "Editar", "fidelizacion-button");
                botonEditar.type = "button";

                botonEditar.addEventListener("click", () => {
                    abrirFormularioGaleria(diseno);
                });

                const botonEstado = elemento(
                        "button",
                        diseno.activo ? "Retirar" : "Reactivar",
                        "fidelizacion-button " +
                        (diseno.activo
                                ? "fidelizacion-button--baja"
                                : "fidelizacion-button--reactivar")
                        );

                botonEstado.type = "button";

                botonEstado.addEventListener("click", () => {
                    cambiarEstadoGaleria(diseno, botonEstado);
                });

                celda.append(botonEditar, botonEstado);
            }
        }
    ];

    document.getElementById("tablaGaleria").replaceChildren(
            crearTabla(columnas, disenosGaleriaCargados)
            );
}

function abrirFormularioGaleria(diseno = null) {
    const formulario = document.getElementById("formularioGaleria");
    formulario.reset();

    document.getElementById("errorFormularioGaleria").textContent = "";
    document.getElementById("campoGaleriaId").value = diseno ? diseno.id : "";

    document.getElementById("tituloFormularioGaleria").textContent =
            diseno ? "Editar diseño" : "Nuevo diseño";

    document.getElementById("campoNombreGaleria").value = diseno ? diseno.nombre : "";
    document.getElementById("campoCategoriaGaleria").value = diseno ? diseno.categoria : "";

    activoOriginalGaleria = diseno ? Boolean(diseno.activo) : null;
    document.getElementById("campoActivoGaleria").checked =
            diseno ? Boolean(diseno.activo) : true;

    const campoImagen = document.getElementById("campoImagenGaleria");
    campoImagen.value = "";
    campoImagen.required = !diseno;

    document.getElementById("etiquetaImagenGaleria").textContent = diseno
            ? "Fotografía (deja vacío para conservar la actual)"
            : "Fotografía (obligatoria)";

    const vistaPreviaContenedor = document.getElementById(
            "vistaPreviaImagenGaleriaContenedor"
            );
    const vistaPrevia = document.getElementById("vistaPreviaImagenGaleria");

    if (diseno && diseno.imagen) {
        vistaPrevia.src = "../fotos/" + diseno.imagen;
        vistaPreviaContenedor.hidden = false;
    } else {
        vistaPrevia.src = "";
        vistaPreviaContenedor.hidden = true;
    }

    const seccion = document.getElementById("seccionFormularioGaleria");
    seccion.hidden = false;
    seccion.scrollIntoView({behavior: "smooth", block: "start"});
}

function cerrarFormularioGaleria() {
    document.getElementById("seccionFormularioGaleria").hidden = true;
    document.getElementById("formularioGaleria").reset();
}

async function guardarGaleria(event) {
    event.preventDefault();

    const id = document.getElementById("campoGaleriaId").value;
    const boton = document.getElementById("botonGuardarGaleria");
    const errorTexto = document.getElementById("errorFormularioGaleria");

    errorTexto.textContent = "";

    const datosFormulario = new FormData();
    datosFormulario.set("nombre", document.getElementById("campoNombreGaleria").value.trim());
    datosFormulario.set("categoria", document.getElementById("campoCategoriaGaleria").value);

    const archivo = document.getElementById("campoImagenGaleria").files[0];

    if (archivo) {
        datosFormulario.set("imagen", archivo);
    }

    const activoNuevo = document.getElementById("campoActivoGaleria").checked;

    if (!id) {
        datosFormulario.set("activo", activoNuevo ? "1" : "0");
    }

    boton.disabled = true;

    try {
        if (id) {
            await api(`/api/admin/galeria/${id}`, {
                method: "PUT",
                body: datosFormulario
            });

            if (activoOriginalGaleria !== null && activoNuevo !== activoOriginalGaleria) {
                await api(`/api/admin/galeria/${id}/estado`, {
                    method: "PATCH",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({activo: activoNuevo})
                });
            }

            mensaje.textContent = "Diseño actualizado correctamente.";
        } else {
            await api("/api/admin/galeria", {
                method: "POST",
                body: datosFormulario
            });

            mensaje.textContent = "Diseño registrado correctamente.";
        }

        cerrarFormularioGaleria();
        await cargarGaleria();
    } catch (error) {
        errorTexto.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
}

async function cambiarEstadoGaleria(diseno, boton) {
    const activar = !diseno.activo;

    const confirmacion = confirm(
            activar
            ? `¿Confirmas reactivar "${diseno.nombre}"?`
            : `¿Confirmas retirar "${diseno.nombre}"? Dejará de mostrarse en la tienda.`
            );

    if (!confirmacion)
        return;

    boton.disabled = true;

    try {
        const datos = await api(`/api/admin/galeria/${diseno.id}/estado`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({activo: activar})
        });

        mensaje.textContent = datos.mensaje;
        await cargarGaleria();
    } catch (error) {
        mensaje.textContent = error.message;
        boton.disabled = false;
    }
}

function construirQueryUsuarios() {
    const buscar = document.getElementById("buscarUsuario").value.trim();
    const rol = document.getElementById("filtroRolUsuario").value;
    const estado = document.getElementById("filtroEstadoUsuario").value;
    const parametros = new URLSearchParams();

    if (buscar)
        parametros.set("buscar", buscar);

    if (rol)
        parametros.set("rol", rol);

    if (estado)
        parametros.set("estado", estado);

    const query = parametros.toString();
    return query ? `?${query}` : "";
}

async function cargarUsuarios() {
    const contenedor = document.getElementById("tablaUsuarios");

    try {
        const datos = await api("/api/admin/usuarios" + construirQueryUsuarios());

        const columnas = [
            {key: "nombre", label: "Nombre completo"},
            {key: "celular", label: "Celular"},
            {
                key: "rol",
                label: "Rol",
                render(celda, usuario) {
                    celda.textContent = nombresRolUsuario[usuario.rol] || usuario.rol;
                }
            },
            {
                key: "activo",
                label: "Estado",
                render(celda, usuario) {
                    celda.append(elemento(
                            "span",
                            usuario.activo ? "Activo" : "Inactivo",
                            "status " + (usuario.activo ? "entregado" : "cancelado")
                            ));
                }
            },
            {
                key: "creado_en",
                label: "Fecha de registro",
                render(celda, usuario) {
                    celda.textContent = formatoFecha(usuario.creado_en);
                }
            },
            {
                key: "acciones",
                label: "Acciones",
                render(celda, usuario) {
                    const esMiPropiaCuenta = usuario.celular === celularSesionActual;

                    if (esMiPropiaCuenta) {
                        celda.append(elemento("span", "Tu cuenta", "admin-form-note"));
                        return;
                    }

                    const botonEstado = elemento(
                            "button",
                            usuario.activo ? "Desactivar" : "Activar",
                            "fidelizacion-button " +
                            (usuario.activo
                                    ? "fidelizacion-button--baja"
                                    : "fidelizacion-button--reactivar")
                            );

                    botonEstado.type = "button";

                    botonEstado.addEventListener("click", () => {
                        cambiarEstadoUsuario(usuario, botonEstado);
                    });

                    celda.append(botonEstado);
                }
            }
        ];

        contenedor.replaceChildren(crearTabla(columnas, datos.usuarios));
    } catch (error) {
        contenedor.textContent = error.message;
    }
}

function abrirFormularioUsuario() {
    const formulario = document.getElementById("formularioUsuario");
    formulario.reset();

    document.getElementById("errorFormularioUsuario").textContent = "";

    const seccion = document.getElementById("seccionFormularioUsuario");
    seccion.hidden = false;
    seccion.scrollIntoView({behavior: "smooth", block: "start"});
}

function cerrarFormularioUsuario() {
    document.getElementById("seccionFormularioUsuario").hidden = true;
    document.getElementById("formularioUsuario").reset();
}

async function guardarUsuario(event) {
    event.preventDefault();

    const boton = document.getElementById("botonGuardarUsuario");
    const errorTexto = document.getElementById("errorFormularioUsuario");

    errorTexto.textContent = "";

    const nombre = document.getElementById("campoNombreUsuario").value.trim();
    const celular = document.getElementById("campoCelularUsuario").value.trim();
    const password = document.getElementById("campoPasswordUsuario").value;
    const passwordConfirmar = document.getElementById("campoPasswordConfirmarUsuario").value;

    if (password !== passwordConfirmar) {
        errorTexto.textContent = "Las contraseñas no coinciden.";
        return;
    }

    boton.disabled = true;

    try {
        const datos = await api("/api/admin/usuarios", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({nombre, celular, password})
        });

        mensaje.textContent = datos.mensaje;
        cerrarFormularioUsuario();
        await cargarUsuarios();
    } catch (error) {
        errorTexto.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
}

async function cambiarEstadoUsuario(usuario, boton) {
    const activar = !usuario.activo;

    const confirmacion = confirm(
            activar
            ? `¿Confirmas activar la cuenta de "${usuario.nombre}"?`
            : `¿Confirmas desactivar la cuenta de "${usuario.nombre}"? No podrá iniciar sesión.`
            );

    if (!confirmacion)
        return;

    boton.disabled = true;

    try {
        const datos = await api(`/api/admin/usuarios/${usuario.id}/estado`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({activo: activar})
        });

        mensaje.textContent = datos.mensaje;
        await cargarUsuarios();
    } catch (error) {
        mensaje.textContent = error.message;
        boton.disabled = false;
    }
}

async function cargarConfiguracion() {
    try {
        const datos = await api("/api/admin/configuracion");

        const negocio = datos.datosNegocio || {};
        document.getElementById("campoNombreNegocio").value = negocio.nombre || "";
        document.getElementById("campoWhatsappNegocio").value = negocio.whatsapp || "";
        document.getElementById("campoTelefonoNegocio").value = negocio.telefono || "";
        document.getElementById("campoDireccionNegocio").value = negocio.direccion || "";
        document.getElementById("campoMapsUrlNegocio").value = negocio.mapsUrl || "";
        document.getElementById("campoFacebookNegocio").value =
                negocio.redesSociales?.facebook || "";
        document.getElementById("campoInstagramNegocio").value =
                negocio.redesSociales?.instagram || "";
        document.getElementById("campoTiktokNegocio").value =
                negocio.redesSociales?.tiktok || "";

        const horarios = datos.horarios || {};
        const diasSeleccionados = Array.isArray(horarios.dias) ? horarios.dias : [];

        document.querySelectorAll("#diasAtencion input[type=checkbox]").forEach((casilla) => {
            casilla.checked = diasSeleccionados.includes(casilla.value);
        });

        document.getElementById("campoHoraApertura").value = horarios.apertura || "";
        document.getElementById("campoHoraCierre").value = horarios.cierre || "";
    } catch (error) {
        mensaje.textContent = error.message;
    }
}

async function guardarSeccionConfiguracion(clave, valor, errorTexto, boton) {
    errorTexto.textContent = "";
    boton.disabled = true;

    try {
        const datos = await api("/api/admin/configuracion", {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({[clave]: valor})
        });

        mensaje.textContent = datos.mensaje;
    } catch (error) {
        errorTexto.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
}

document.getElementById("formularioDatosNegocio").addEventListener("submit", (event) => {
    event.preventDefault();

    const valor = {
        nombre: document.getElementById("campoNombreNegocio").value.trim(),
        whatsapp: document.getElementById("campoWhatsappNegocio").value.trim(),
        telefono: document.getElementById("campoTelefonoNegocio").value.trim(),
        direccion: document.getElementById("campoDireccionNegocio").value.trim(),
        mapsUrl: document.getElementById("campoMapsUrlNegocio").value.trim(),
        redesSociales: {
            facebook: document.getElementById("campoFacebookNegocio").value.trim(),
            instagram: document.getElementById("campoInstagramNegocio").value.trim(),
            tiktok: document.getElementById("campoTiktokNegocio").value.trim()
        }
    };

    guardarSeccionConfiguracion(
            "datosNegocio",
            valor,
            document.getElementById("errorDatosNegocio"),
            event.submitter
            );
});

document.getElementById("formularioHorarios").addEventListener("submit", (event) => {
    event.preventDefault();

    const dias = [...document.querySelectorAll("#diasAtencion input:checked")]
            .map((casilla) => casilla.value);

    const valor = {
        dias,
        apertura: document.getElementById("campoHoraApertura").value,
        cierre: document.getElementById("campoHoraCierre").value
    };

    guardarSeccionConfiguracion(
            "horarios",
            valor,
            document.getElementById("errorHorarios"),
            event.submitter
            );
});

let cerrarMenuPedidoActivo = null;

function cerrarMenuPedido() {
    if (cerrarMenuPedidoActivo) {
        cerrarMenuPedidoActivo();
        cerrarMenuPedidoActivo = null;
    }
}

function crearTarjetaPedido(pedido) {
    const tarjeta = document.createElement("article");
    tarjeta.className = "kanban-card";

    const encabezado = document.createElement("div");
    encabezado.className = "kanban-card__encabezado";
    encabezado.append(elemento("span", "Pedido #" + pedido.id, "kanban-card__numero"));

    if (pedido.estado !== "entregado") {
        const botonMenu = document.createElement("button");
        botonMenu.type = "button";
        botonMenu.className = "kanban-card__menu-boton";
        botonMenu.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        botonMenu.setAttribute("aria-label", "Opciones del pedido " + pedido.id);

        botonMenu.addEventListener("click", (evento) => {
            evento.stopPropagation();
            abrirMenuPedido(pedido, botonMenu, tarjeta);
        });

        encabezado.append(botonMenu);
    }

    tarjeta.append(encabezado);
    tarjeta.append(elemento("p", pedido.nombre_cliente, "kanban-card__cliente"));

    if (pedido.origen && pedido.origen !== "web") {
        tarjeta.append(elemento(
                "span",
                "Manual · " + (NOMBRES_ORIGEN_PEDIDO[pedido.origen] || pedido.origen),
                "pedido-origen-etiqueta"
                ));
    }

    tarjeta.append(elemento(
            "p",
            pedido.productos || "Sin productos registrados",
            "kanban-card__productos"
            ));
    tarjeta.append(elemento("p", formatoPrecio(pedido.total), "kanban-card__total"));

    // Fecha en que el cliente realizó el pedido (creado_en): nunca se
    // reemplaza por la fecha de recojo, son dos datos distintos.
    tarjeta.append(elemento(
            "p",
            "Pedido realizado: " + formatoFecha(pedido.creado_en),
            "kanban-card__creado"
            ));

    const fechaTexto = pedido.fecha_solicitada
            ? "Recojo: " + formatoFecha(pedido.fecha_solicitada) + " · " +
                    formatoHora(pedido.hora_solicitada)
            : "Fecha de recojo por coordinar";

    tarjeta.append(elemento("p", fechaTexto, "kanban-card__fecha"));

    return tarjeta;
}

function abrirMenuPedido(pedido, botonMenu, tarjeta) {
    cerrarMenuPedido();

    const menu = document.createElement("div");
    menu.className = "kanban-card__menu";

    const opciones = pedido.estado === "pendiente"
            ? [["confirmado", "Confirmar"], ["cancelado", "Cancelar"]]
            : [["entregado", "Entregado"]];

    opciones.forEach(([valor, texto]) => {
        const opcion = document.createElement("button");
        opcion.type = "button";
        opcion.className = "kanban-card__menu-opcion";
        opcion.textContent = texto;

        opcion.addEventListener("click", () => {
            cerrarMenuPedido();
            cambiarEstadoPedido(pedido, valor, tarjeta);
        });

        menu.append(opcion);
    });

    // Disponible para pendiente y confirmado: el calendario de delivery
    // usa esta misma fecha/hora una vez que el pedido queda confirmado.
    const opcionFecha = document.createElement("button");
    opcionFecha.type = "button";
    opcionFecha.className = "kanban-card__menu-opcion";
    opcionFecha.textContent = "Editar fecha/hora";

    opcionFecha.addEventListener("click", () => {
        cerrarMenuPedido();
        abrirEditorFechaPedido(pedido, tarjeta);
    });

    menu.append(opcionFecha);

    botonMenu.parentElement.append(menu);

    function cerrar() {
        menu.remove();
        document.removeEventListener("click", cerrarPorFueraDelMenu);
    }

    function cerrarPorFueraDelMenu(evento) {
        if (!menu.contains(evento.target) && evento.target !== botonMenu) {
            cerrar();
        }
    }

    document.addEventListener("click", cerrarPorFueraDelMenu);
    cerrarMenuPedidoActivo = cerrar;
}

// Reemplaza temporalmente el texto de fecha de la tarjeta por un editor
// mínimo (fecha + hora + lugar), sin tocar la máquina de estados del Kanban.
function abrirEditorFechaPedido(pedido, tarjeta) {
    const parrafoFecha = tarjeta.querySelector(".kanban-card__fecha");

    if (!parrafoFecha) {
        return;
    }

    const editor = document.createElement("div");
    editor.className = "kanban-card__editor-fecha";

    const campoFecha = document.createElement("input");
    campoFecha.type = "date";
    campoFecha.value = extraerFechaISO(pedido.fecha_solicitada);

    const campoHora = document.createElement("input");
    campoHora.type = "time";
    campoHora.value = pedido.hora_solicitada
            ? String(pedido.hora_solicitada).slice(0, 5)
            : "";

    const campoLugar = document.createElement("input");
    campoLugar.type = "text";
    campoLugar.placeholder = "Lugar de recojo";
    campoLugar.maxLength = 255;
    campoLugar.value = pedido.direccion_entrega || "";

    const acciones = document.createElement("div");
    acciones.className = "kanban-card__editor-acciones";

    const botonGuardar = elemento("button", "Guardar", "kanban-card__editor-guardar");
    botonGuardar.type = "button";

    const botonCancelar = elemento("button", "Cancelar", "kanban-card__editor-cancelar");
    botonCancelar.type = "button";

    const errorTexto = elemento("p", "", "kanban-card__editor-error");

    botonCancelar.addEventListener("click", () => {
        editor.replaceWith(parrafoFecha);
    });

    botonGuardar.addEventListener("click", async () => {
        errorTexto.textContent = "";
        botonGuardar.disabled = true;

        try {
            const datos = await api(`/api/admin/pedidos/${pedido.id}/entrega`, {
                method: "PATCH",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    fechaSolicitada: campoFecha.value,
                    horaSolicitada: campoHora.value,
                    lugarRecojo: campoLugar.value.trim()
                })
            });

            pedido.fecha_solicitada = datos.fechaSolicitada;
            pedido.hora_solicitada = datos.horaSolicitada;
            pedido.direccion_entrega = datos.lugarRecojo || "";

            const nuevoTexto =
                    formatoFecha(datos.fechaSolicitada) + " · " +
                    formatoHora(datos.horaSolicitada);

            editor.replaceWith(elemento("p", nuevoTexto, "kanban-card__fecha"));
            mensaje.textContent = datos.mensaje;
        } catch (error) {
            errorTexto.textContent = error.message;
            botonGuardar.disabled = false;
        }
    });

    acciones.append(botonGuardar, botonCancelar);
    editor.append(campoFecha, campoHora, campoLugar, acciones, errorTexto);
    parrafoFecha.replaceWith(editor);
}

async function cambiarEstadoPedido(pedido, nuevoEstado, tarjeta) {
    const mensajesConfirmacion = {
        cancelado: `¿Confirmas cancelar el pedido #${pedido.id}? No se podrá reactivar.`,
        entregado: `¿Confirmas que el pedido #${pedido.id} ya fue entregado?`
    };

    if (mensajesConfirmacion[nuevoEstado] && !confirm(mensajesConfirmacion[nuevoEstado])) {
        return;
    }

    tarjeta.classList.add("kanban-card--cargando");

    try {
        await api(`/api/admin/pedidos/${pedido.id}/estado`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({estado: nuevoEstado})
        });

        mensaje.textContent = "Estado del pedido actualizado.";
        tarjeta.remove();

        if (nuevoEstado !== "cancelado") {
            pedido.estado = nuevoEstado;

            const nuevaTarjeta = crearTarjetaPedido(pedido);
            const columnaDestino = document.getElementById(
                    nuevoEstado === "confirmado" ? "kanbanConfirmado" : "kanbanEntregado"
                    );

            columnaDestino.append(nuevaTarjeta);

            if (nuevoEstado === "entregado") {
                setTimeout(() => nuevaTarjeta.remove(), 10000);
            }
        }

        await cargarResumen();
    } catch (error) {
        mensaje.textContent = error.message;
        tarjeta.classList.remove("kanban-card--cargando");
    }
}

async function cargarKanban() {
    const datos = await api("/api/admin/pedidos?estado=activos");
    const pedidos = datos.pedidos || [];

    const columnas = {
        pendiente: document.getElementById("kanbanPendiente"),
        confirmado: document.getElementById("kanbanConfirmado")
    };

    columnas.pendiente.replaceChildren();
    columnas.confirmado.replaceChildren();

    const vacio = {pendiente: true, confirmado: true};

    pedidos.forEach((pedido) => {
        const columna = columnas[pedido.estado];

        if (!columna)
            return;

        columna.append(crearTarjetaPedido(pedido));
        vacio[pedido.estado] = false;
    });

    Object.entries(vacio).forEach(([estado, estaVacio]) => {
        if (estaVacio) {
            columnas[estado].append(elemento(
                    "div",
                    "Sin pedidos en esta etapa.",
                    "empty-state"
                    ));
        }
    });
}

function crearTablaMasVendidos(productos) {
    return crearTabla(
            [
                {key: "nombre", label: "Producto"},
                {key: "cantidad", label: "Cantidad vendida"}
            ],
            productos
            );
}

function crearTablaProximasEntregas(pedidos) {
    return crearTabla(
            [
                {key: "nombre_cliente", label: "Cliente"},
                {
                    key: "fecha_solicitada",
                    label: "Fecha de entrega",
                    render(celda, pedido) {
                        celda.textContent = formatoFecha(pedido.fecha_solicitada);
                    }
                },
                {
                    key: "hora_solicitada",
                    label: "Hora de entrega",
                    render(celda, pedido) {
                        celda.textContent = formatoHora(pedido.hora_solicitada);
                    }
                },
                {
                    key: "productos",
                    label: "Productos",
                    render(celda, pedido) {
                        celda.textContent = pedido.productos || "—";
                    }
                }
            ],
            pedidos
            );
}

async function cargarResumen() {
    const datos = await api("/api/admin/resumen");

    document.getElementById("pedidosActivos").textContent = datos.pedidosActivos;
    document.getElementById("pedidosEntregadosMes").textContent = datos.pedidosEntregadosMes;
    document.getElementById("productosDisponibles").textContent = datos.productosDisponibles;
    document.getElementById("totalProductos").textContent = datos.totalProductos;

    document.getElementById("tablaPedidosInicio").replaceChildren(
            crearTablaPedidos(datos.ultimosPedidos || [])
            );

    document.getElementById("tablaProximasEntregas").replaceChildren(
            crearTablaProximasEntregas(datos.proximasEntregas || [])
            );

    document.getElementById("tablaMasVendidosMes").replaceChildren(
            crearTablaMasVendidos(datos.productosMasVendidosMes || [])
            );
}


// Progreso visual de sellos hacia la recompensa de la novena compra (ej. "1/9").
// El conteo sigue siendo exactamente comprasEntregadas, solo se limita la
// barra y el texto a 9 para la representación visual.
function crearProgresoSellos(comprasEntregadas) {
    const compras = Number(comprasEntregadas) || 0;
    const progreso = Math.min(compras, 9);
    const porcentaje = Math.round((progreso / 9) * 100);

    const contenedor = document.createElement("div");
    contenedor.className = "sellos-progreso";

    contenedor.append(elemento("span", `${progreso}/9`, "sellos-progreso__texto"));

    const barra = document.createElement("div");
    barra.className = "sellos-progreso__barra";

    const relleno = document.createElement("div");
    relleno.className = "sellos-progreso__relleno";
    relleno.style.width = porcentaje + "%";

    barra.append(relleno);
    contenedor.append(barra);

    return contenedor;
}

function pintarEstadoBeneficio(celda, cliente, beneficio) {
    const compras = Number(cliente.comprasEntregadas);
    const entregado = beneficio === "primera_compra"
            ? cliente.primeraCompraEntregada
            : cliente.novenaCompraEntregada;
    const umbral = beneficio === "primera_compra" ? 1 : 9;

    if (entregado) {
        celda.append(elemento("span", "Entregado", "status entregado"));
        return;
    }

    if (compras >= umbral) {
        const boton = elemento("button", "Registrar entrega", "fidelizacion-button");
        boton.type = "button";

        boton.addEventListener("click", () => {
            registrarEntrega(cliente.usuarioId, beneficio, boton);
        });

        celda.append(
                elemento("span", "Pendiente", "status pendiente"),
                boton
                );
        return;
    }

    celda.append(elemento("span", "No disponible", "status cancelado"));
}

function crearTablaClientesFidelizacion(clientes) {
    const columnas = [
        {key: "nombre", label: "Cliente"},
        {key: "celular", label: "Celular"},
        {
            key: "comprasEntregadas",
            label: "Sellos acumulados",
            render(celda, cliente) {
                celda.append(crearProgresoSellos(cliente.comprasEntregadas));
            }
        },
        {
            key: "primera",
            label: "Primera compra",
            render(celda, cliente) {
                pintarEstadoBeneficio(celda, cliente, "primera_compra");
            }
        },
        {
            key: "novena",
            label: "Novena compra",
            render(celda, cliente) {
                pintarEstadoBeneficio(celda, cliente, "novena_compra");
            }
        },
        {
            key: "historial",
            label: "Historial",
            render(celda, cliente) {
                const boton = elemento("button", "Ver historial", "text-button");
                boton.type = "button";

                boton.addEventListener("click", () => {
                    abrirHistorialCliente(cliente);
                });

                celda.append(boton);
            }
        }
    ];

    return crearTabla(columnas, clientes);
}

function crearTablaRecompensasDisponibles(disponibles) {
    const columnas = [
        {key: "nombre", label: "Cliente"},
        {key: "celular", label: "Celular"},
        {
            key: "comprasEntregadas",
            label: "Sellos acumulados",
            render(celda, item) {
                celda.append(crearProgresoSellos(item.comprasEntregadas));
            }
        },
        {key: "etiquetaBeneficio", label: "Recompensa"},
        {
            key: "estado",
            label: "Estado",
            render(celda, item) {
                celda.append(elemento("span", "Pendiente de entrega", "status pendiente"));
            }
        },
        {
            key: "accion",
            label: "Acción",
            render(celda, item) {
                const boton = elemento("button", "Marcar como entregada", "fidelizacion-button");
                boton.type = "button";

                boton.addEventListener("click", () => {
                    registrarEntrega(item.usuarioId, item.beneficio, boton);
                });

                celda.append(boton);
            }
        }
    ];

    return crearTabla(columnas, disponibles);
}

function crearTablaHistorialCompras(historial) {
    const columnas = [
        {key: "id", label: "N.º pedido"},
        {
            key: "total",
            label: "Total",
            render(celda, pedido) {
                celda.textContent = formatoPrecio(pedido.total);
            }
        },
        {
            key: "fecha_entregada",
            label: "Fecha de entrega",
            render(celda, pedido) {
                celda.textContent = formatoFecha(pedido.fecha_entregada);
            }
        }
    ];

    return crearTabla(columnas, historial);
}

async function abrirHistorialCliente(cliente) {
    document.getElementById("tituloHistorialCliente").textContent =
            "Historial de compras — " + cliente.nombre;

    const contenedor = document.getElementById("tablaHistorialCliente");
    contenedor.textContent = "Cargando historial...";

    const seccion = document.getElementById("seccionHistorialCliente");
    seccion.hidden = false;
    seccion.scrollIntoView({behavior: "smooth", block: "start"});

    try {
        const datos = await api(`/api/admin/fidelizacion/${cliente.usuarioId}/historial`);
        contenedor.replaceChildren(crearTablaHistorialCompras(datos.historial));
    } catch (error) {
        contenedor.textContent = error.message;
    }
}

async function cargarClientesFidelizacion() {
    const buscar = document.getElementById("buscarCliente").value.trim();
    const contenedor = document.getElementById("tablaFidelizacion");
    contenedor.textContent = "Cargando clientes...";

    try {
        const query = buscar ? `?buscar=${encodeURIComponent(buscar)}` : "";
        const datos = await api("/api/admin/fidelizacion" + query);
        contenedor.replaceChildren(crearTablaClientesFidelizacion(datos.clientes));
    } catch (error) {
        contenedor.textContent = error.message;
    }
}

async function cargarRecompensas() {
    const contenedorDisponibles = document.getElementById("tablaRecompensasDisponibles");

    try {
        // Las recompensas siempre se calculan sobre el listado completo,
        // sin el filtro de búsqueda de la sección Clientes.
        const datos = await api("/api/admin/fidelizacion");
        const clientes = datos.clientes;

        const disponibles = [];

        clientes.forEach((cliente) => {
            const compras = Number(cliente.comprasEntregadas);

            if (!cliente.primeraCompraEntregada && compras >= 1) {
                disponibles.push({
                    ...cliente,
                    beneficio: "primera_compra",
                    etiquetaBeneficio: "Primera compra"
                });
            }

            if (!cliente.novenaCompraEntregada && compras >= 9) {
                disponibles.push({
                    ...cliente,
                    beneficio: "novena_compra",
                    etiquetaBeneficio: "Novena compra"
                });
            }
        });

        contenedorDisponibles.replaceChildren(crearTablaRecompensasDisponibles(disponibles));
    } catch (error) {
        contenedorDisponibles.textContent = error.message;
    }
}

async function cargarFidelizacion() {
    await Promise.all([
        cargarClientesFidelizacion(),
        cargarRecompensas()
    ]);
}


// Registrar la entrega de un beneficio.
async function registrarEntrega(usuarioId, beneficio, boton) {

    const confirmacion = confirm(
        "¿Confirmas que este beneficio ya fue entregado al cliente?"
    );

    if (!confirmacion) return;

    boton.disabled = true;

    try {

        const datos = await api(
            `/api/admin/fidelizacion/${usuarioId}/${beneficio}/entrega`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({})
            }
        );

        mensaje.textContent = datos.mensaje;

        await cargarFidelizacion();

    } catch (error) {

        mensaje.textContent = error.message;
        boton.disabled = false;
    }
}

function crearEstrellas(calificacion) {
    const valor = Number(calificacion) || 0;
    return "★".repeat(valor) + "☆".repeat(Math.max(0, 5 - valor));
}

function crearTablaResenas(resenas, permitirAcciones) {
    const columnas = [
        {key: "nombreCliente", label: "Cliente"},
        {
            key: "nombreProducto",
            label: "Producto",
            render(celda, resena) {
                celda.textContent = resena.nombreProducto || "—";
            }
        },
        {
            key: "calificacion",
            label: "Calificación",
            render(celda, resena) {
                celda.append(elemento(
                        "span",
                        crearEstrellas(resena.calificacion),
                        "resenas-estrellas"
                        ));
            }
        },
        {key: "comentario", label: "Comentario"},
        {
            key: "fotografia",
            label: "Fotografía",
            render(celda, resena) {
                if (!resena.fotografia) {
                    celda.textContent = "—";
                    return;
                }

                const imagen = document.createElement("img");
                imagen.src = "../fotos/" + resena.fotografia;
                imagen.alt = "Fotografía de la reseña";
                imagen.className = "resenas-foto-miniatura";
                celda.append(imagen);
            }
        },
        {
            key: "fecha",
            label: "Fecha",
            render(celda, resena) {
                celda.textContent = formatoFecha(resena.creado_en);
            }
        },
        {
            key: "estado",
            label: "Estado",
            render(celda, resena) {
                const etiquetas = {
                    pendiente: "Pendiente",
                    aprobada: "Aprobada",
                    oculta: "Oculta"
                };

                const clases = {
                    pendiente: "pendiente",
                    aprobada: "entregado",
                    oculta: "cancelado"
                };

                celda.append(elemento(
                        "span",
                        etiquetas[resena.estado] || resena.estado,
                        "status " + (clases[resena.estado] || "pendiente")
                        ));
            }
        }
    ];

    if (permitirAcciones) {
        columnas.push({
            key: "acciones",
            label: "Acciones",
            render(celda, resena) {
                const botonAprobar = elemento("button", "Aprobar y publicar", "fidelizacion-button");
                botonAprobar.type = "button";

                botonAprobar.addEventListener("click", () => {
                    cambiarEstadoResena(resena.id, "aprobada", botonAprobar);
                });

                const botonOcultar = elemento(
                        "button", "Ocultar", "fidelizacion-button fidelizacion-button--baja"
                        );
                botonOcultar.type = "button";

                botonOcultar.addEventListener("click", () => {
                    cambiarEstadoResena(resena.id, "oculta", botonOcultar);
                });

                celda.append(botonAprobar, botonOcultar);
            }
        });
    }

    return crearTabla(columnas, resenas);
}

async function cambiarEstadoResena(id, estado, boton) {
    const confirmacion = confirm(
            estado === "aprobada"
            ? "¿Confirmas aprobar y publicar esta reseña?"
            : "¿Confirmas ocultar esta reseña?"
            );

    if (!confirmacion)
        return;

    boton.disabled = true;

    try {
        const datos = await api(`/api/admin/resenas/${id}/estado`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({estado})
        });

        mensaje.textContent = datos.mensaje;
        await cargarResenas();
    } catch (error) {
        mensaje.textContent = error.message;
        boton.disabled = false;
    }
}

async function cargarTodasResenas() {
    const contenedor = document.getElementById("tablaResenasTodas");
    contenedor.textContent = "Cargando reseñas...";

    try {
        const datos = await api("/api/admin/resenas");
        contenedor.replaceChildren(crearTablaResenas(datos.resenas, false));
    } catch (error) {
        contenedor.textContent = error.message;
    }
}

async function cargarPendientesResenas() {
    const contenedor = document.getElementById("tablaResenasPendientes");
    contenedor.textContent = "Cargando reseñas...";

    try {
        const datos = await api("/api/admin/resenas?estado=pendiente");
        contenedor.replaceChildren(crearTablaResenas(datos.resenas, true));
    } catch (error) {
        contenedor.textContent = error.message;
    }
}

function crearTablaMejorValorados(productos) {
    return crearTabla(
            [
                {key: "nombreProducto", label: "Producto"},
                {
                    key: "promedio",
                    label: "Promedio",
                    render(celda, item) {
                        celda.textContent = Number(item.promedio).toFixed(1) + " ★";
                    }
                },
                {key: "totalResenas", label: "Reseñas"}
            ],
            productos
            );
}

async function cargarEstadisticasResenas() {
    const contenedorDistribucion = document.getElementById("resenasDistribucion");
    const contenedorMejorValorados = document.getElementById("resenasMejorValorados");

    try {
        const datos = await api("/api/admin/resenas/estadisticas");

        document.getElementById("resenasTotal").textContent = datos.total;
        document.getElementById("resenasPromedio").textContent =
                datos.total > 0 ? Number(datos.promedio).toFixed(1) + " ★" : "—";

        contenedorDistribucion.replaceChildren();

        for (let estrellas = 5; estrellas >= 1; estrellas--) {
            const fila = datos.distribucion.find((item) => item.calificacion === estrellas);
            const total = fila ? Number(fila.total) : 0;
            const porcentaje = datos.total > 0 ? Math.round((total / datos.total) * 100) : 0;

            const contenedorFila = document.createElement("div");
            contenedorFila.className = "resenas-distribucion-fila";

            const barra = document.createElement("div");
            barra.className = "sellos-progreso__barra";

            const relleno = document.createElement("div");
            relleno.className = "sellos-progreso__relleno";
            relleno.style.width = porcentaje + "%";
            barra.append(relleno);

            contenedorFila.append(
                    elemento("span", `${estrellas} ★`),
                    barra,
                    elemento("span", String(total))
                    );

            contenedorDistribucion.append(contenedorFila);
        }

        contenedorMejorValorados.replaceChildren(
                crearTablaMejorValorados(datos.mejorValorados || [])
                );
    } catch (error) {
        contenedorDistribucion.textContent = error.message;
        contenedorMejorValorados.textContent = "";
    }
}

async function cargarResenas() {
    await Promise.all([
        cargarTodasResenas(),
        cargarPendientesResenas(),
        cargarEstadisticasResenas()
    ]);
}

function cambiarSeccion(seccion) {
    const vistasConocidas = ["inicio", "productos", "pedidos", "fidelizacion", "resenas", "galeria", "usuarios", "configuracion", "calendario"];
    const vista = vistasConocidas.includes(seccion) ? seccion : "pendiente";

    document.querySelectorAll(".module-view").forEach((elementoVista) => {
        elementoVista.hidden = elementoVista.id !== "view-" + vista;
    });

    document.querySelectorAll(".nav-item[data-section]").forEach((boton) => {
        boton.classList.toggle("active", boton.dataset.section === seccion);
    });

    document.getElementById("pageTitle").textContent =
            titulos[seccion] || "Panel administrativo";

    if (vista === "pendiente") {
        document.getElementById("placeholderTitle").textContent =
                titulos[seccion] || "Módulo en preparación";

        document.getElementById("placeholderText").textContent =
                descripciones[seccion] ||
                "Esta sección se conectará a la base de datos en la siguiente etapa.";

        document.getElementById("placeholderIcon").className =
                "fa-solid " + (iconos[seccion] || "fa-screwdriver-wrench");
    }
    if (vista === "fidelizacion") {
        cargarFidelizacion();
    }
    if (vista === "pedidos") {
        cargarKanban();
    }
    if (vista === "resenas") {
        cargarResenas();
    }
    if (vista === "galeria") {
        cargarGaleria();
    }
    if (vista === "usuarios") {
        cargarUsuarios();
    }
    if (vista === "configuracion") {
        cargarConfiguracion();
    }
    if (vista === "calendario") {
        cargarCalendario();
    }
    document.getElementById("sidebar").classList.remove("open");
}

document.querySelectorAll(".nav-item[data-section]").forEach((boton) => {
    boton.addEventListener("click", () => {
        cambiarSeccion(boton.dataset.section);
    });
});

document.querySelectorAll("[data-go]").forEach((boton) => {
    boton.addEventListener("click", () => {
        cambiarSeccion(boton.dataset.go);
    });
});

document.getElementById("mobileMenu").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
});

document.getElementById("botonNuevoProducto").addEventListener("click", () => {
    abrirFormularioProducto(null);
});

document.getElementById("botonCerrarFormularioProducto").addEventListener("click", () => {
    cerrarFormularioProducto();
});

document.getElementById("formularioProducto").addEventListener("submit", guardarProducto);

document.getElementById("botonAgregarDetalle").addEventListener("click", () => {
    agregarFilaDetalle();
});

document.getElementById("botonAgregarPresentacion").addEventListener("click", () => {
    agregarFilaPresentacion();
});

document.getElementById("filtroCategoriaProducto").addEventListener("change", cargarProductos);
document.getElementById("filtroEstadoProducto").addEventListener("change", cargarProductos);

let debounceBusquedaCliente = null;

document.getElementById("buscarCliente").addEventListener("input", () => {
    clearTimeout(debounceBusquedaCliente);
    debounceBusquedaCliente = setTimeout(cargarClientesFidelizacion, 300);
});

document.getElementById("botonCerrarHistorialCliente").addEventListener("click", () => {
    document.getElementById("seccionHistorialCliente").hidden = true;
});

document.getElementById("campoImagen").addEventListener("change", (evento) => {
    const archivo = evento.target.files[0];

    if (!archivo)
        return;

    const vistaPreviaContenedor = document.getElementById("vistaPreviaImagenContenedor");
    const vistaPrevia = document.getElementById("vistaPreviaImagen");
    const lector = new FileReader();

    lector.onload = () => {
        vistaPrevia.src = lector.result;
        vistaPreviaContenedor.hidden = false;
    };

    lector.readAsDataURL(archivo);
});

document.getElementById("botonNuevoDiseno").addEventListener("click", () => {
    abrirFormularioGaleria(null);
});

document.getElementById("botonCerrarFormularioGaleria").addEventListener("click", () => {
    cerrarFormularioGaleria();
});

document.getElementById("formularioGaleria").addEventListener("submit", guardarGaleria);

document.getElementById("filtroCategoriaGaleria").addEventListener("change", cargarGaleria);
document.getElementById("filtroEstadoGaleria").addEventListener("change", cargarGaleria);

document.getElementById("campoImagenGaleria").addEventListener("change", (evento) => {
    const archivo = evento.target.files[0];

    if (!archivo)
        return;

    const vistaPreviaContenedor = document.getElementById(
            "vistaPreviaImagenGaleriaContenedor"
            );
    const vistaPrevia = document.getElementById("vistaPreviaImagenGaleria");
    const lector = new FileReader();

    lector.onload = () => {
        vistaPrevia.src = lector.result;
        vistaPreviaContenedor.hidden = false;
    };

    lector.readAsDataURL(archivo);
});

document.getElementById("botonNuevoAdmin").addEventListener("click", () => {
    abrirFormularioUsuario();
});

document.getElementById("botonCerrarFormularioUsuario").addEventListener("click", () => {
    cerrarFormularioUsuario();
});

document.getElementById("formularioUsuario").addEventListener("submit", guardarUsuario);

document.getElementById("filtroRolUsuario").addEventListener("change", cargarUsuarios);
document.getElementById("filtroEstadoUsuario").addEventListener("change", cargarUsuarios);

let debounceBusquedaUsuario = null;

document.getElementById("buscarUsuario").addEventListener("input", () => {
    clearTimeout(debounceBusquedaUsuario);
    debounceBusquedaUsuario = setTimeout(cargarUsuarios, 300);
});

const NOMBRES_MES_CALENDARIO = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const NOMBRES_METODO_PAGO = {
    yape: "Yape",
    transferencia: "Transferencia",
    efectivo: "Efectivo",
    otro: "Otro"
};

const NOMBRES_ESTADO_PAGO = {
    pendiente: "Pendiente de pago",
    parcial: "Adelanto parcial",
    pagado: "Pagado"
};

let calendarioMesActual = null;
let calendarioAnioActual = null;
let calendarioFechaSeleccionada = null;
let calendarioResumenDias = {};
let pedidoDetalleActual = null;

async function cargarCalendario() {
    if (calendarioMesActual === null) {
        const ahora = new Date();
        calendarioMesActual = ahora.getMonth() + 1;
        calendarioAnioActual = ahora.getFullYear();
    }

    await cargarResumenCalendario();
}

async function cargarResumenCalendario() {
    document.getElementById("calendarioMesTitulo").textContent =
            `${NOMBRES_MES_CALENDARIO[calendarioMesActual - 1]} ${calendarioAnioActual}`;

    try {
        const datos = await api(
                `/api/admin/calendario/resumen?mes=${calendarioMesActual}` +
                `&anio=${calendarioAnioActual}`
                );

        calendarioResumenDias = {};
        (datos.dias || []).forEach((dia) => {
            calendarioResumenDias[dia.fecha] = dia.cantidad;
        });
    } catch (error) {
        mensaje.textContent = error.message;
        calendarioResumenDias = {};
    }

    renderizarCalendarioGrid();
}

function renderizarCalendarioGrid() {
    const grid = document.getElementById("calendarioGrid");
    grid.replaceChildren();

    const primerDiaMes = new Date(calendarioAnioActual, calendarioMesActual - 1, 1);
    const diasEnMes = new Date(calendarioAnioActual, calendarioMesActual, 0).getDate();
    const offset = (primerDiaMes.getDay() + 6) % 7;
    const hoyTexto = fechaLocalPeruISO();

    for (let i = 0; i < offset; i++) {
        grid.append(elemento("div", "", "calendario-dia calendario-dia--vacio"));
    }

    for (let dia = 1; dia <= diasEnMes; dia++) {
        const fechaTexto =
                `${calendarioAnioActual}-` +
                `${String(calendarioMesActual).padStart(2, "0")}-` +
                `${String(dia).padStart(2, "0")}`;

        const cantidad = calendarioResumenDias[fechaTexto] || 0;

        const celda = document.createElement("button");
        celda.type = "button";
        celda.className = "calendario-dia";

        if (cantidad > 0)
            celda.classList.add("calendario-dia--con-pedidos");

        if (fechaTexto === hoyTexto)
            celda.classList.add("calendario-dia--hoy");

        if (fechaTexto === calendarioFechaSeleccionada)
            celda.classList.add("calendario-dia--seleccionado");

        celda.append(elemento("span", String(dia), "calendario-dia__numero"));

        if (cantidad > 0) {
            celda.append(elemento("span", String(cantidad), "calendario-dia__badge"));
        }

        celda.addEventListener("click", () => seleccionarFechaCalendario(fechaTexto));

        grid.append(celda);
    }
}

function cambiarMesCalendario(delta) {
    calendarioMesActual += delta;

    if (calendarioMesActual > 12) {
        calendarioMesActual = 1;
        calendarioAnioActual++;
    } else if (calendarioMesActual < 1) {
        calendarioMesActual = 12;
        calendarioAnioActual--;
    }

    cargarResumenCalendario();
}

async function seleccionarFechaCalendario(fecha) {
    calendarioFechaSeleccionada = fecha;
    renderizarCalendarioGrid();

    document.getElementById("seccionDetallePedido").hidden = true;
    document.getElementById("seccionPedidosFecha").hidden = false;
    document.getElementById("tituloPedidosFecha").textContent =
            "Pedidos confirmados — " + formatoFecha(fecha);

    const contenedor = document.getElementById("listaPedidosFecha");
    contenedor.className = "loading-text";
    contenedor.textContent = "Cargando pedidos...";

    try {
        const datos = await api(`/api/admin/calendario/dia?fecha=${fecha}`);
        contenedor.className = "";
        renderizarPedidosDelDia(datos.pedidos || []);
    } catch (error) {
        contenedor.textContent = error.message;
    }
}

function renderizarPedidosDelDia(pedidos) {
    const contenedor = document.getElementById("listaPedidosFecha");

    if (!pedidos.length) {
        contenedor.replaceChildren(
                elemento("p", "No hay pedidos confirmados para esta fecha.", "loading-text")
                );
        return;
    }

    const columnas = [
        {
            key: "id",
            label: "N.º pedido",
            render(celda, pedido) {
                celda.textContent = "#" + pedido.id;
            }
        },
        {key: "nombreCliente", label: "Cliente"},
        {
            key: "horaSolicitada",
            label: "Hora",
            render(celda, pedido) {
                celda.textContent = formatoHora(pedido.horaSolicitada);
            }
        },
        {key: "cantidadItems", label: "Cantidad"},
        {key: "productos", label: "Productos"},
        {
            key: "acciones",
            label: "Acciones",
            render(celda, pedido) {
                const boton = elemento("button", "Ver detalles", "fidelizacion-button");
                boton.type = "button";
                boton.addEventListener("click", () => abrirDetallePedido(pedido.id));
                celda.append(boton);
            }
        }
    ];

    contenedor.replaceChildren(crearTabla(columnas, pedidos));
}

async function abrirDetallePedido(pedidoId) {
    const seccion = document.getElementById("seccionDetallePedido");
    seccion.hidden = false;
    cerrarFormularioAdicional();
    seccion.scrollIntoView({behavior: "smooth", block: "start"});

    try {
        const datos = await api(`/api/admin/pedidos/${pedidoId}/detalle-completo`);
        pedidoDetalleActual = datos;

        document.getElementById("detalleNumeroPedido").textContent = "#" + datos.pedido.id;
        document.getElementById("detalleClienteNombre").textContent = datos.pedido.nombreCliente;
        document.getElementById("detalleClienteCelular").textContent =
                datos.pedido.celularCliente;
        document.getElementById("detalleFechaHora").textContent =
                formatoFecha(datos.pedido.fechaSolicitada) + " · " +
                formatoHora(datos.pedido.horaSolicitada);

        document.getElementById("detalleLugarRecojo").textContent =
                datos.pedido.lugarRecojo
                ? "Lugar de recojo: " + datos.pedido.lugarRecojo
                : "Lugar de recojo por coordinar";

        const etiquetaOrigen = document.getElementById("detalleOrigenPedido");

        if (datos.pedido.origen && datos.pedido.origen !== "web") {
            etiquetaOrigen.hidden = false;
            etiquetaOrigen.textContent =
                    "Manual · " +
                    (NOMBRES_ORIGEN_PEDIDO[datos.pedido.origen] || datos.pedido.origen);
        } else {
            etiquetaOrigen.hidden = true;
        }

        document.getElementById("tablaDetalleProductos").replaceChildren(crearTabla(
                [
                    {key: "nombre_producto", label: "Producto"},
                    {
                        key: "presentacion",
                        label: "Presentación",
                        render(celda, producto) {
                            celda.textContent = producto.presentacion || "—";
                        }
                    },
                    {key: "cantidad", label: "Cantidad"},
                    {
                        key: "subtotal",
                        label: "Subtotal",
                        render(celda, producto) {
                            celda.textContent = formatoPrecio(producto.subtotal);
                        }
                    }
                ],
                datos.productos
                ));

        const contenedorNotas = document.getElementById("contenedorNotasPedido");

        if (datos.pedido.notas) {
            contenedorNotas.hidden = false;
            document.getElementById("detalleNotasPedido").textContent = datos.pedido.notas;
        } else {
            contenedorNotas.hidden = true;
        }

        document.getElementById("botonNuevoAdicional").hidden =
                datos.pedido.estado === "entregado";

        renderizarAdicionales(datos.adicionales, datos.pedido.estado);
        renderizarPagos(datos.pagos);
        renderizarTotalesPedido(datos.totales);
    } catch (error) {
        mensaje.textContent = error.message;
    }
}

function renderizarAdicionales(adicionales, estadoPedido) {
    const contenedor = document.getElementById("tablaAdicionales");
    const bloqueado = estadoPedido === "entregado";

    if (!adicionales.length) {
        contenedor.replaceChildren(
                elemento("p", "Sin adicionales registrados.", "loading-text")
                );
        return;
    }

    const columnas = [
        {key: "nombre", label: "Nombre"},
        {
            key: "descripcion",
            label: "Descripción",
            render(celda, adicional) {
                celda.textContent = adicional.descripcion || "—";
            }
        },
        {
            key: "precio",
            label: "Precio",
            render(celda, adicional) {
                celda.textContent = formatoPrecio(adicional.precio);
            }
        },
        {
            key: "activo",
            label: "Estado",
            render(celda, adicional) {
                celda.append(elemento(
                        "span",
                        adicional.activo ? "Activo" : "Desactivado",
                        "status " + (adicional.activo ? "entregado" : "cancelado")
                        ));
            }
        },
        {
            key: "acciones",
            label: "Acciones",
            render(celda, adicional) {
                if (bloqueado) {
                    celda.append(elemento("span", "Pedido entregado", "admin-form-note"));
                    return;
                }

                const botonEditar = elemento("button", "Editar", "fidelizacion-button");
                botonEditar.type = "button";
                botonEditar.addEventListener("click", () => abrirFormularioAdicional(adicional));

                const botonEstado = elemento(
                        "button",
                        adicional.activo ? "Desactivar" : "Activar",
                        "fidelizacion-button " +
                        (adicional.activo
                                ? "fidelizacion-button--baja"
                                : "fidelizacion-button--reactivar")
                        );
                botonEstado.type = "button";
                botonEstado.addEventListener("click", () => {
                    cambiarEstadoAdicional(adicional, botonEstado);
                });

                celda.append(botonEditar, botonEstado);
            }
        }
    ];

    contenedor.replaceChildren(crearTabla(columnas, adicionales));
}

function abrirFormularioAdicional(adicional = null) {
    const formulario = document.getElementById("formularioAdicional");
    formulario.reset();
    formulario.hidden = false;

    document.getElementById("errorAdicional").textContent = "";
    document.getElementById("campoAdicionalId").value = adicional ? adicional.id : "";
    document.getElementById("campoAdicionalNombre").value = adicional ? adicional.nombre : "";
    document.getElementById("campoAdicionalPrecio").value = adicional ? adicional.precio : "";
    document.getElementById("campoAdicionalDescripcion").value =
            adicional?.descripcion || "";

    formulario.scrollIntoView({behavior: "smooth", block: "center"});
}

function cerrarFormularioAdicional() {
    const formulario = document.getElementById("formularioAdicional");
    formulario.hidden = true;
    formulario.reset();
}

async function guardarAdicional(event) {
    event.preventDefault();

    const id = document.getElementById("campoAdicionalId").value;
    const boton = document.getElementById("botonGuardarAdicional");
    const errorTexto = document.getElementById("errorAdicional");
    errorTexto.textContent = "";

    const cuerpo = {
        nombre: document.getElementById("campoAdicionalNombre").value.trim(),
        precio: Number(document.getElementById("campoAdicionalPrecio").value),
        descripcion: document.getElementById("campoAdicionalDescripcion").value.trim()
    };

    boton.disabled = true;

    try {
        const pedidoId = pedidoDetalleActual.pedido.id;

        if (id) {
            await api(`/api/admin/pedidos/${pedidoId}/adicionales/${id}`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(cuerpo)
            });
        } else {
            await api(`/api/admin/pedidos/${pedidoId}/adicionales`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(cuerpo)
            });
        }

        mensaje.textContent = "Adicional guardado correctamente.";
        cerrarFormularioAdicional();
        await abrirDetallePedido(pedidoId);
    } catch (error) {
        errorTexto.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
}

async function cambiarEstadoAdicional(adicional, boton) {
    const activar = !adicional.activo;

    const confirmacion = confirm(
            activar
            ? `¿Confirmas reactivar "${adicional.nombre}"?`
            : `¿Confirmas desactivar "${adicional.nombre}"?`
            );

    if (!confirmacion)
        return;

    boton.disabled = true;

    try {
        const pedidoId = pedidoDetalleActual.pedido.id;

        await api(`/api/admin/pedidos/${pedidoId}/adicionales/${adicional.id}/estado`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({activo: activar})
        });

        mensaje.textContent = "Estado del adicional actualizado.";
        await abrirDetallePedido(pedidoId);
    } catch (error) {
        mensaje.textContent = error.message;
        boton.disabled = false;
    }
}

function renderizarPagos(pagos) {
    const contenedor = document.getElementById("tablaPagos");

    if (!pagos.length) {
        contenedor.replaceChildren(
                elemento("p", "Todavía no se registran pagos.", "loading-text")
                );
        return;
    }

    const columnas = [
        {
            key: "fecha_pago",
            label: "Fecha",
            render(celda, pago) {
                celda.textContent = formatoFecha(pago.fecha_pago);
            }
        },
        {
            key: "monto",
            label: "Monto",
            render(celda, pago) {
                celda.textContent = formatoPrecio(pago.monto);
            }
        },
        {
            key: "metodo_pago",
            label: "Método",
            render(celda, pago) {
                celda.textContent = NOMBRES_METODO_PAGO[pago.metodo_pago] || pago.metodo_pago;
            }
        },
        {
            key: "referencia",
            label: "Referencia",
            render(celda, pago) {
                celda.textContent = pago.referencia || "—";
            }
        }
    ];

    contenedor.replaceChildren(crearTabla(columnas, pagos));
}

function crearLineaTotalPedido(etiqueta, valor, destacado) {
    const linea = document.createElement("div");
    linea.className = "detalle-pedido-totales__linea" +
            (destacado ? " detalle-pedido-totales__linea--destacado" : "");
    linea.append(elemento("span", etiqueta), elemento("strong", formatoPrecio(valor)));
    return linea;
}

function renderizarTotalesPedido(totales) {
    const contenedor = document.getElementById("totalesPedido");

    const claseEstado = totales.estadoPago === "pagado"
            ? "entregado"
            : totales.estadoPago === "parcial"
                    ? "en-preparacion"
                    : "cancelado";

    const lineaEstado = document.createElement("div");
    lineaEstado.className = "detalle-pedido-totales__estado";
    lineaEstado.append(elemento(
            "span",
            NOMBRES_ESTADO_PAGO[totales.estadoPago] || totales.estadoPago,
            "status " + claseEstado
            ));

    contenedor.replaceChildren(
            crearLineaTotalPedido("Subtotal de productos", totales.subtotalProductos),
            crearLineaTotalPedido("Adicionales activos", totales.totalAdicionalesActivos),
            crearLineaTotalPedido("Total del pedido", totales.totalGeneral, true),
            crearLineaTotalPedido("Total pagado", totales.totalPagado),
            crearLineaTotalPedido("Saldo pendiente", totales.saldoPendiente, true),
            lineaEstado
            );
}

document.getElementById("botonMesAnterior").addEventListener("click", () => {
    cambiarMesCalendario(-1);
});

document.getElementById("botonMesSiguiente").addEventListener("click", () => {
    cambiarMesCalendario(1);
});

document.getElementById("botonCerrarDetallePedido").addEventListener("click", () => {
    document.getElementById("seccionDetallePedido").hidden = true;
});

document.getElementById("botonNuevoAdicional").addEventListener("click", () => {
    abrirFormularioAdicional(null);
});

document.getElementById("botonCancelarAdicional").addEventListener("click", () => {
    cerrarFormularioAdicional();
});

document.getElementById("formularioAdicional").addEventListener("submit", guardarAdicional);

document.getElementById("formularioPago").addEventListener("submit", async (event) => {
    event.preventDefault();

    const boton = document.getElementById("botonRegistrarPago");
    const errorTexto = document.getElementById("errorPago");
    errorTexto.textContent = "";

    const cuerpo = {
        monto: Number(document.getElementById("campoPagoMonto").value),
        metodoPago: document.getElementById("campoPagoMetodo").value,
        referencia: document.getElementById("campoPagoReferencia").value.trim()
    };

    const fecha = document.getElementById("campoPagoFecha").value;

    if (fecha) {
        cuerpo.fecha = fecha;
    }

    boton.disabled = true;

    try {
        const pedidoId = pedidoDetalleActual.pedido.id;

        const datos = await api(`/api/admin/pedidos/${pedidoId}/pagos`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(cuerpo)
        });

        mensaje.textContent = datos.mensaje;
        document.getElementById("formularioPago").reset();
        await abrirDetallePedido(pedidoId);
    } catch (error) {
        errorTexto.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
});

const NOMBRES_ORIGEN_PEDIDO = {
    whatsapp: "WhatsApp",
    llamada: "Llamada",
    presencial: "Presencial"
};

// Catálogo cacheado la primera vez que se abre el formulario de pedido
// manual (solo productos activos: son los únicos que el backend acepta).
let catalogoProductosManual = null;

async function obtenerCatalogoProductosManual() {
    if (!catalogoProductosManual) {
        const datos = await api("/api/admin/productos?estado=activos");
        catalogoProductosManual = datos.productos || [];
    }

    return catalogoProductosManual;
}

// Precio vigente de una fila según el producto y la presentación elegidos,
// igual que ya hace el backend: la presentación manda sobre el precio base.
function precioVigenteFilaManual(fila) {
    const idProducto = Number(fila.querySelector(".pedido-manual-row__producto").value);
    const producto = (catalogoProductosManual || []).find((item) => item.id === idProducto);

    if (!producto) {
        return null;
    }

    const selectPresentacion = fila.querySelector(".pedido-manual-row__presentacion");
    const presentacion = selectPresentacion.hidden ? "" : selectPresentacion.value;

    if (
            presentacion &&
            producto.presentaciones &&
            typeof producto.presentaciones === "object" &&
            !Array.isArray(producto.presentaciones)
            ) {
        const precioPresentacion = Number(producto.presentaciones[presentacion]);

        if (Number.isFinite(precioPresentacion)) {
            return precioPresentacion;
        }
    }

    const precioBase = Number(producto.precio);
    return Number.isFinite(precioBase) ? precioBase : null;
}

// Solo recalcula precio/subtotal a partir de lo que YA está seleccionado.
// Nunca toca las <option> del selector de presentación: si lo hiciera cada
// vez que cambia la presentación (o la cantidad), perdería la selección del
// usuario y el navegador volvería a marcar la primera opción por defecto.
function actualizarSubtotalFilaManual(fila) {
    const campoCantidad = fila.querySelector(".pedido-manual-row__cantidad");
    const spanSubtotal = fila.querySelector(".pedido-manual-row__subtotal");

    const precio = precioVigenteFilaManual(fila);
    const cantidad = Math.max(1, Number(campoCantidad.value) || 1);

    spanSubtotal.textContent = precio === null ? "—" : formatoPrecio(precio * cantidad);

    actualizarTotalPedidoManual();
}

// Reconstruye las opciones de presentación según el producto elegido. Solo
// debe llamarse cuando CAMBIA EL PRODUCTO (las presentaciones dependen de
// cuál producto es, no de cuál presentación ya estaba elegida).
function reconstruirPresentacionesFilaManual(fila) {
    const selectProducto = fila.querySelector(".pedido-manual-row__producto");
    const selectPresentacion = fila.querySelector(".pedido-manual-row__presentacion");

    const idProducto = Number(selectProducto.value);
    const producto = (catalogoProductosManual || []).find((item) => item.id === idProducto);

    const mapaPresentaciones =
            producto?.presentaciones &&
            typeof producto.presentaciones === "object" &&
            !Array.isArray(producto.presentaciones)
            ? producto.presentaciones
            : null;

    if (mapaPresentaciones && Object.keys(mapaPresentaciones).length) {
        selectPresentacion.hidden = false;
        selectPresentacion.replaceChildren();

        Object.entries(mapaPresentaciones).forEach(([etiqueta, precio]) => {
            const opcion = document.createElement("option");
            opcion.value = etiqueta;
            opcion.textContent = `${etiqueta} (${formatoPrecio(precio)})`;
            selectPresentacion.append(opcion);
        });
    } else {
        selectPresentacion.hidden = true;
        selectPresentacion.replaceChildren();
    }

    actualizarSubtotalFilaManual(fila);
}

function crearFilaProductoManual() {
    const fila = document.createElement("div");
    fila.className = "pedido-manual-row";

    const selectProducto = document.createElement("select");
    selectProducto.className = "pedido-manual-row__producto";

    const opcionVacia = document.createElement("option");
    opcionVacia.value = "";
    opcionVacia.textContent = "Selecciona un producto";
    selectProducto.append(opcionVacia);

    (catalogoProductosManual || []).forEach((producto) => {
        const opcion = document.createElement("option");
        opcion.value = String(producto.id);
        opcion.textContent = producto.nombre;
        selectProducto.append(opcion);
    });

    const selectPresentacion = document.createElement("select");
    selectPresentacion.className = "pedido-manual-row__presentacion";
    selectPresentacion.hidden = true;

    const campoCantidad = document.createElement("input");
    campoCantidad.type = "number";
    campoCantidad.className = "pedido-manual-row__cantidad";
    campoCantidad.min = "1";
    campoCantidad.value = "1";

    const spanSubtotal = elemento("span", "—", "pedido-manual-row__subtotal");

    const botonQuitar = document.createElement("button");
    botonQuitar.type = "button";
    botonQuitar.className = "admin-dynamic-row__quitar";
    botonQuitar.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    botonQuitar.setAttribute("aria-label", "Quitar producto");
    botonQuitar.addEventListener("click", () => {
        fila.remove();
        actualizarTotalPedidoManual();
    });

    selectProducto.addEventListener("change", () => reconstruirPresentacionesFilaManual(fila));
    selectPresentacion.addEventListener("change", () => actualizarSubtotalFilaManual(fila));
    campoCantidad.addEventListener("input", () => actualizarSubtotalFilaManual(fila));

    fila.append(selectProducto, selectPresentacion, campoCantidad, spanSubtotal, botonQuitar);
    return fila;
}

function actualizarTotalPedidoManual() {
    let total = 0;

    document.querySelectorAll("#filasProductosManual .pedido-manual-row").forEach((fila) => {
        const precio = precioVigenteFilaManual(fila);
        const cantidad = Math.max(
                1,
                Number(fila.querySelector(".pedido-manual-row__cantidad").value) || 1
                );

        if (precio !== null) {
            total += precio * cantidad;
        }
    });

    document.getElementById("totalPedidoManual").replaceChildren(
            crearLineaTotalPedido("Total del pedido", Math.round(total * 100) / 100, true)
            );
}

async function abrirFormularioPedidoManual() {
    const formulario = document.getElementById("formularioPedidoManual");
    const error = document.getElementById("errorPedidoManual");
    error.textContent = "";
    formulario.reset();
    document.getElementById("filasProductosManual").replaceChildren();

    try {
        await obtenerCatalogoProductosManual();
    } catch (err) {
        error.textContent = "No se pudo cargar el catálogo de productos.";
    }

    document.getElementById("filasProductosManual").append(crearFilaProductoManual());
    actualizarTotalPedidoManual();

    formulario.hidden = false;
    formulario.scrollIntoView({behavior: "smooth", block: "start"});
}

function cerrarFormularioPedidoManual() {
    const formulario = document.getElementById("formularioPedidoManual");
    formulario.hidden = true;
    formulario.reset();
    document.getElementById("filasProductosManual").replaceChildren();
}

document.getElementById("botonPedidoManual").addEventListener("click", () => {
    abrirFormularioPedidoManual();
});

document.getElementById("botonAgregarProductoManual").addEventListener("click", () => {
    document.getElementById("filasProductosManual").append(crearFilaProductoManual());
});

document.getElementById("botonCancelarPedidoManual").addEventListener("click", () => {
    cerrarFormularioPedidoManual();
});

document.getElementById("formularioPedidoManual").addEventListener("submit", async (event) => {
    event.preventDefault();

    const boton = document.getElementById("botonGuardarPedidoManual");
    const error = document.getElementById("errorPedidoManual");
    error.textContent = "";

    const items = [];

    document.querySelectorAll("#filasProductosManual .pedido-manual-row").forEach((fila) => {
        const idProducto = fila.querySelector(".pedido-manual-row__producto").value;
        const selectPresentacion = fila.querySelector(".pedido-manual-row__presentacion");
        const cantidad = Number(fila.querySelector(".pedido-manual-row__cantidad").value);

        if (idProducto && cantidad >= 1) {
            items.push({
                productoId: idProducto,
                cantidad,
                presentacion: selectPresentacion.hidden ? "" : selectPresentacion.value
            });
        }
    });

    if (items.length === 0) {
        error.textContent = "Agrega al menos un producto al pedido.";
        return;
    }

    const cuerpo = {
        nombreCliente: document.getElementById("campoManualNombre").value.trim(),
        celularCliente: document.getElementById("campoManualCelular").value.trim(),
        origen: document.getElementById("campoManualOrigen").value,
        tipoEntrega: document.getElementById("campoManualTipoEntrega").value,
        lugarRecojo: document.getElementById("campoManualLugar").value.trim(),
        fechaSolicitada: document.getElementById("campoManualFecha").value,
        horaSolicitada: document.getElementById("campoManualHora").value,
        notas: document.getElementById("campoManualNotas").value.trim(),
        items
    };

    boton.disabled = true;

    try {
        const datos = await api("/api/admin/pedidos/manual", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(cuerpo)
        });

        mensaje.textContent = datos.mensaje;
        cerrarFormularioPedidoManual();
        await cargarKanban();
    } catch (err) {
        error.textContent = err.message;
    } finally {
        boton.disabled = false;
    }
});

document.getElementById("cerrarSesion").addEventListener("click", async () => {
    try {
        await api("/api/logout", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: "{}"
        });
    } catch (error) {
        mensaje.textContent = error.message;
    } finally {
        window.location.href = "/html/login.html";
    }
});

async function iniciarPanel() {
    try {
        const sesion = await api("/api/sesion");

        celularSesionActual = sesion.usuario.celular;

        document.getElementById("saludo").textContent =
                "¡Bienvenida, " + sesion.usuario.nombre + "! Resumen general de la pastelería.";

        await Promise.all([
            cargarResumen(),
            cargarProductos(),
            cargarKanban()
        ]);
    } catch (error) {
        mensaje.textContent = error.message;
    }
}

iniciarPanel();

