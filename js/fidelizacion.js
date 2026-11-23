
document.addEventListener("DOMContentLoaded", async () => {

    const nombreCliente = document.getElementById("nombreCliente");
    const totalCompras = document.getElementById("totalCompras");
    const progresoCompras = document.getElementById("progresoCompras");
    const porcentajeProgreso = document.getElementById("porcentajeProgreso");
    const barraProgreso = document.getElementById("barraProgreso");
    const mensajeProgreso = document.getElementById("mensajeProgreso");

    const estadoPrimeraCompra = document.getElementById("estadoPrimeraCompra");
    const estadoPremio = document.getElementById("estadoPremio");
    const mensajeError = document.getElementById("mensajeError");

    try {
        // Verificar que exista una sesión de cliente.
        const respuestaSesion = await fetch("/api/sesion", {
            credentials: "same-origin",
            cache: "no-store"
        });

        if (!respuestaSesion.ok) {
            window.location.href = "/html/login.html";
            return;
        }

        const sesion = await respuestaSesion.json();

        if (!sesion.autenticado || sesion.usuario.rol !== "cliente") {
            window.location.href = "/html/login.html";
            return;
        }

        nombreCliente.textContent = sesion.usuario.nombre;

        // Consultar las compras entregadas del cliente.
        const respuesta = await fetch("/api/cliente/fidelizacion", {
            credentials: "same-origin",
            cache: "no-store"
        });

        const datos = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(datos.error || "No se pudo consultar la fidelización.");
        }

        const compras = Number(datos.comprasEntregadas);
        const progreso = Math.min(compras, 8);
        const porcentaje = Math.round((progreso / 8) * 100);

        totalCompras.textContent = compras;
        progresoCompras.textContent = `${progreso} de 8`;
        porcentajeProgreso.textContent = `${porcentaje}%`;
        barraProgreso.style.width = `${porcentaje}%`;

        // Beneficio de la primera compra: 3 estados posibles.
        if (datos.primeraCompraEntregada) {
            estadoPrimeraCompra.textContent = "¡Ya recibiste tu docena de mini alfajores!";
            estadoPrimeraCompra.className = "beneficio-estado--recibido";
        } else if (datos.primeraCompraCompletada) {
            estadoPrimeraCompra.textContent =
                    "¡Disponible! La administradora te la entregará en tu próxima visita.";
            estadoPrimeraCompra.className = "beneficio-estado--disponible";
        }

        // Beneficio de la novena compra: 3 estados posibles.
        if (datos.novenaCompraEntregada) {

            estadoPremio.textContent = "¡Ya recibiste tu regalo especial!";
            estadoPremio.className = "beneficio-estado--recibido";

            mensajeProgreso.textContent =
                    "¡Felicidades! Ya recibiste tu regalo especial de la novena compra.";

        } else if (compras >= 9) {

            estadoPremio.textContent =
                    "¡Disponible! La administradora te lo entregará en tu próxima visita.";
            estadoPremio.className = "beneficio-estado--disponible";

            mensajeProgreso.textContent =
                    "¡Felicidades! Has completado tu novena compra y alcanzado tu premio.";

        } else if (compras === 8) {

            mensajeProgreso.textContent =
                    "¡Excelente! Has completado ocho compras. " +
                    "En tu próxima compra recibirás tu regalo especial.";

        } else if (compras === 0) {

            mensajeProgreso.textContent =
                    "Realiza tu primera compra para comenzar a acumular beneficios.";

        } else {

            const restantes = 8 - compras;

            mensajeProgreso.textContent =
                    `Te faltan ${restantes} compras para conseguir tu premio de la novena compra.`;
        }

        await cargarHistorialCompras();

    } catch (error) {
        console.error("Error de fidelización:", error);

        mensajeError.textContent =
                "No se pudo cargar tu información de fidelización. Inténtalo nuevamente.";

        mensajeError.hidden = false;
    }

    async function cargarHistorialCompras() {
        const contenedor = document.getElementById("listaHistorialCompras");

        try {
            const respuestaHistorial = await fetch("/api/cliente/fidelizacion/historial", {
                credentials: "same-origin",
                cache: "no-store"
            });

            const datosHistorial = await respuestaHistorial.json();

            if (!respuestaHistorial.ok) {
                throw new Error(datosHistorial.error || "No se pudo cargar tu historial.");
            }

            const historial = datosHistorial.historial || [];

            if (!historial.length) {
                contenedor.replaceChildren();
                const vacio = document.createElement("p");
                vacio.className = "historial-vacio";
                vacio.textContent = "Todavía no tienes compras entregadas.";
                contenedor.append(vacio);
                return;
            }

            contenedor.replaceChildren();

            historial.forEach((pedido) => {
                const fila = document.createElement("div");
                fila.className = "historial-item";

                const fecha = document.createElement("span");
                const fechaObjeto = pedido.fecha_entregada ? new Date(pedido.fecha_entregada) : null;

                fecha.textContent = fechaObjeto && !Number.isNaN(fechaObjeto.getTime())
                        ? fechaObjeto.toLocaleDateString("es-PE", {
                            day: "2-digit", month: "2-digit", year: "numeric"
                        })
                        : "—";

                const total = document.createElement("strong");
                total.textContent = `S/ ${Number(pedido.total || 0).toFixed(2)}`;

                fila.append(fecha, total);
                contenedor.append(fila);
            });
        } catch (error) {
            console.error("Error al cargar el historial:", error);
            contenedor.replaceChildren();

            const errorTexto = document.createElement("p");
            errorTexto.className = "historial-vacio";
            errorTexto.textContent = "No se pudo cargar tu historial de compras.";
            contenedor.append(errorTexto);
        }
    }

});
