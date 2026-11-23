
// Resuelve la clave de localStorage del carrito según la sesión actual:
// cada cuenta de cliente tiene su propio carrito ("carrito_usuario_<id>");
// sin sesión de cliente se usa un carrito de invitado aparte
// ("carrito_invitado"). Nunca se vuelve a leer/escribir la clave global
// antigua ("carritoLasDeliciasDeGra"): sus datos quedan intactos pero sin
// asignarse a ninguna cuenta. Esta misma función se repite tal cual en
// menu.html, detalle-producto.html y agregar-carrito.html (no hay un
// sistema de módulos en el proyecto); el IIFE evita que esas copias choquen
// entre sí cuando varias cargan en la misma página.
(function () {
    if (window.obtenerClaveCarrito) return;

    let promesaClave = null;

    window.obtenerClaveCarrito = function obtenerClaveCarrito() {
        if (!promesaClave) {
            promesaClave = (async () => {
                try {
                    const respuesta = await fetch("/api/sesion", {
                        credentials: "same-origin",
                        cache: "no-store"
                    });

                    if (respuesta.ok) {
                        const datos = await respuesta.json();

                        if (
                                datos.autenticado &&
                                datos.usuario?.rol === "cliente" &&
                                datos.usuario?.id
                                ) {
                            return `carrito_usuario_${datos.usuario.id}`;
                        }
                    }
                } catch (error) {
                    console.error("No se pudo resolver la sesión para el carrito:", error);
                }

                return "carrito_invitado";
            })();
        }

        return promesaClave;
    };
})();

document.addEventListener("DOMContentLoaded", () => {
    const loginLink = document.getElementById("loginLink");
    const loginTexto = document.getElementById("loginTexto");
    const fidelizacionLink = document.getElementById("fidelizacionLink");

    // Actualizar el contador del carrito (propio de la cuenta autenticada).
    async function actualizarContadorCarrito() {
        const contador = document.getElementById("contadorCarrito");

        if (!contador) return;

        try {
            const clave = await window.obtenerClaveCarrito();

            const carrito = JSON.parse(
                localStorage.getItem(clave) || "[]"
            );

            const cantidad = carrito.reduce((total, producto) => {
                return total + (Number(producto.cantidad) || 0);
            }, 0);

            contador.textContent = cantidad;
        } catch (error) {
            console.error("Error al leer el carrito:", error);
            contador.textContent = "0";
        }
    }

    // Consultar y actualizar la sesión.
    async function actualizarCuenta() {
        if (!loginLink || !loginTexto) return;

        try {
            const respuesta = await fetch("/api/sesion", {
                credentials: "same-origin",
                cache: "no-store"
            });

            if (!respuesta.ok) return;

            const datos = await respuesta.json();

            if (!datos.autenticado || !datos.usuario) {
                loginTexto.textContent = "Iniciar sesión";
                loginLink.href = "login.html";
                loginLink.onclick = null;

                if (fidelizacionLink)
                    fidelizacionLink.hidden = true;

                return;
            }

            if (fidelizacionLink) {
                fidelizacionLink.hidden = datos.usuario.rol !== "cliente";
            }

            loginTexto.textContent = datos.usuario.nombre;
            loginLink.href = "#";
            loginLink.title = "Pulsa para cerrar sesión";

            loginLink.onclick = async (evento) => {
                evento.preventDefault();

                if (!confirm("¿Deseas cerrar tu sesión?")) return;

                try {
                    const salida = await fetch("/api/logout", {
                        method: "POST",
                        credentials: "same-origin"
                    });

                    if (!salida.ok) {
                        alert("No se pudo cerrar la sesión.");
                        return;
                    }

                    window.location.reload();
                } catch (error) {
                    console.error(error);
                    alert("Ocurrió un error al cerrar sesión.");
                }
            };
        } catch (error) {
            console.error("Error al consultar la sesión:", error);
        }
    }

    actualizarContadorCarrito();
    actualizarCuenta();
});
