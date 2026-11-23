document.addEventListener("DOMContentLoaded", async () => {

    const reviewsContainer = document.getElementById("reviewsContainer");
    const reviewsEmpty = document.getElementById("reviewsEmpty");
    const ratingNumber = document.getElementById("ratingNumber");
    const ratingStars = document.getElementById("ratingStars");
    const ratingSummary = document.getElementById("ratingSummary");

    function escaparHTML(valor) {
        return String(valor ?? "").replace(/[&<>"']/g, (caracter) => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[caracter]);
    }

    function formatoFecha(valor) {
        if (!valor)
            return "";

        const fecha = new Date(valor);

        if (Number.isNaN(fecha.getTime()))
            return "";

        return fecha.toLocaleDateString("es-PE", {
            day: "2-digit", month: "2-digit", year: "numeric"
        });
    }

    function iconosEstrellas(calificacion) {
        const valor = Number(calificacion) || 0;
        let html = "";

        for (let i = 1; i <= 5; i++) {
            html += i <= valor
                    ? '<i class="fa-solid fa-star" aria-hidden="true"></i>'
                    : '<i class="fa-regular fa-star" aria-hidden="true"></i>';
        }

        return html;
    }

    // Reseñas aprobadas, públicas, visibles para cualquier visitante.
    async function cargarResenasPublicas() {
        try {
            const respuesta = await fetch("/api/resenas", {cache: "no-store"});
            const datos = await respuesta.json();

            if (!respuesta.ok) {
                throw new Error(datos.error || "No se pudieron cargar las reseñas.");
            }

            const resenas = datos.resenas || [];

            if (!resenas.length) {
                reviewsEmpty.hidden = false;
                return;
            }

            reviewsEmpty.hidden = true;

            resenas.forEach((resena) => {
                const tarjeta = document.createElement("article");
                tarjeta.className = "review-card";

                const inicial = (resena.nombreCliente || "?").trim().charAt(0).toUpperCase();

                tarjeta.innerHTML = `
                    <div class="review-card__header">
                        <div class="review-card__avatar">${escaparHTML(inicial)}</div>
                        <div class="review-card__customer">
                            <h3>${escaparHTML(resena.nombreCliente)}</h3>
                            <span>Cliente verificado</span>
                        </div>
                    </div>
                    <div class="review-card__stars">${iconosEstrellas(resena.calificacion)}</div>
                    <blockquote>${escaparHTML(resena.comentario)}</blockquote>
                    ${resena.fotografia
                        ? `<img class="review-card__foto" src="../fotos/${escaparHTML(resena.fotografia)}" alt="Fotografía de la reseña">`
                        : ""}
                    <div class="review-card__footer">
                        <span>${escaparHTML(resena.nombreProducto || "Producto")}</span>
                        <time>${escaparHTML(formatoFecha(resena.creado_en))}</time>
                    </div>`;

                reviewsContainer.appendChild(tarjeta);
            });

            const promedio = resenas.reduce((total, item) => total + Number(item.calificacion), 0)
                    / resenas.length;

            ratingNumber.textContent = promedio.toFixed(1);
            ratingStars.innerHTML = iconosEstrellas(Math.round(promedio));
            ratingStars.setAttribute("aria-label", `Calificación promedio de ${promedio.toFixed(1)} de 5`);

            ratingSummary.textContent =
                    `Basado en ${resenas.length} ${resenas.length === 1 ? "reseña" : "reseñas"} de clientes.`;
        } catch (error) {
            console.error("Error al cargar las reseñas públicas:", error);
        }
    }

    await cargarResenasPublicas();

    // --- Zona autenticada: formulario y "tus reseñas" ---

    const reviewAccessCard = document.getElementById("reviewAccessCard");
    const reviewFormSection = document.getElementById("reviewFormSection");
    const misResenasSection = document.getElementById("misResenasSection");
    const campoPedidoProducto = document.getElementById("campoPedidoProducto");
    const sinPendientesResena = document.getElementById("sinPendientesResena");
    const formularioResena = document.getElementById("formularioResena");
    const errorFormularioResena = document.getElementById("errorFormularioResena");
    const exitoFormularioResena = document.getElementById("exitoFormularioResena");
    const campoCalificacion = document.getElementById("campoCalificacion");
    const botonEnviarResena = document.getElementById("botonEnviarResena");
    const listaMisResenas = document.getElementById("listaMisResenas");

    async function api(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, {
            credentials: "same-origin",
            cache: "no-store",
            ...opciones
        });

        const datos = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(datos.error || "No se pudo completar la solicitud.");
        }

        return datos;
    }

    function pintarEstrellasSeleccionadas(valor) {
        document.querySelectorAll("#selectorEstrellas .estrella").forEach((boton) => {
            const activa = Number(boton.dataset.valor) <= valor;
            boton.classList.toggle("activa", activa);
        });
    }

    document.querySelectorAll("#selectorEstrellas .estrella").forEach((boton) => {
        boton.addEventListener("click", () => {
            const valor = Number(boton.dataset.valor);
            campoCalificacion.value = valor;
            pintarEstrellasSeleccionadas(valor);
        });
    });

    async function cargarPendientesResena() {
        const datos = await api("/api/cliente/resenas/pendientes");
        const pendientes = datos.pendientes || [];

        campoPedidoProducto.replaceChildren();

        if (!pendientes.length) {
            formularioResena.hidden = true;
            sinPendientesResena.hidden = false;
            return;
        }

        formularioResena.hidden = false;
        sinPendientesResena.hidden = true;

        pendientes.forEach((item) => {
            const opcion = document.createElement("option");
            opcion.value = `${item.pedidoId}:${item.productoId}`;
            opcion.textContent = `${item.nombreProducto} (pedido #${item.pedidoId})`;
            campoPedidoProducto.appendChild(opcion);
        });
    }

    const etiquetasEstadoResena = {
        pendiente: "Pendiente de aprobación",
        aprobada: "Publicada",
        oculta: "Oculta por el administrador"
    };

    async function cargarMisResenas() {
        const datos = await api("/api/cliente/resenas");
        const resenas = datos.resenas || [];

        listaMisResenas.replaceChildren();

        if (!resenas.length) {
            const vacio = document.createElement("p");
            vacio.className = "mis-resenas-vacio";
            vacio.textContent = "Todavía no has escrito ninguna reseña.";
            listaMisResenas.appendChild(vacio);
            return;
        }

        resenas.forEach((resena) => {
            const fila = document.createElement("div");
            fila.className = "mis-resenas-item";

            fila.innerHTML = `
                <div class="mis-resenas-item__info">
                    <strong>${escaparHTML(resena.nombreProducto || "Producto")}</strong>
                    <span class="review-card__stars">${iconosEstrellas(resena.calificacion)}</span>
                    <p>${escaparHTML(resena.comentario)}</p>
                </div>
                <span class="mis-resenas-item__estado mis-resenas-item__estado--${escaparHTML(resena.estado)}">
                    ${escaparHTML(etiquetasEstadoResena[resena.estado] || resena.estado)}
                </span>`;

            listaMisResenas.appendChild(fila);
        });
    }

    async function iniciarZonaCliente() {
        try {
            const sesion = await api("/api/sesion");

            if (!sesion.autenticado || sesion.usuario.rol !== "cliente") {
                return;
            }

            if (reviewAccessCard)
                reviewAccessCard.hidden = true;

            reviewFormSection.hidden = false;
            misResenasSection.hidden = false;

            await Promise.all([
                cargarPendientesResena(),
                cargarMisResenas()
            ]);
        } catch (error) {
            // Sin sesión de cliente: se deja la tarjeta de inicio de sesión visible.
        }
    }

    await iniciarZonaCliente();

    if (formularioResena) {
        formularioResena.addEventListener("submit", async (evento) => {
            evento.preventDefault();

            errorFormularioResena.textContent = "";
            exitoFormularioResena.textContent = "";

            const seleccion = campoPedidoProducto.value;

            if (!seleccion) {
                errorFormularioResena.textContent = "Selecciona un producto para reseñar.";
                return;
            }

            const [pedidoId, productoId] = seleccion.split(":");
            const calificacion = Number(campoCalificacion.value);

            if (!calificacion) {
                errorFormularioResena.textContent = "Elige una calificación de 1 a 5 estrellas.";
                return;
            }

            const datosFormulario = new FormData();
            datosFormulario.set("pedidoId", pedidoId);
            datosFormulario.set("productoId", productoId);
            datosFormulario.set("calificacion", String(calificacion));
            datosFormulario.set(
                    "comentario",
                    document.getElementById("campoComentario").value.trim()
                    );

            const archivo = document.getElementById("campoFotoResena").files[0];

            if (archivo) {
                datosFormulario.set("foto", archivo);
            }

            botonEnviarResena.disabled = true;

            try {
                const datos = await api("/api/cliente/resenas", {
                    method: "POST",
                    body: datosFormulario
                });

                exitoFormularioResena.textContent = datos.mensaje;
                formularioResena.reset();
                campoCalificacion.value = "0";
                pintarEstrellasSeleccionadas(0);

                await Promise.all([
                    cargarPendientesResena(),
                    cargarMisResenas()
                ]);
            } catch (error) {
                errorFormularioResena.textContent = error.message;
            } finally {
                botonEnviarResena.disabled = false;
            }
        });
    }

});
