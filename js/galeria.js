const nombresCategoriasGaleria = {
    cumpleanos: "Cumpleaños",
    infantiles: "Infantiles",
    eventos: "Eventos especiales",
    elegantes: "Diseños elegantes"
};

function crearTarjetaGaleria(diseno) {
    const articulo = document.createElement("article");
    articulo.className = "galeria-item";
    articulo.dataset.category = diseno.categoria;

    const boton = document.createElement("button");
    boton.className = "galeria-item__imagen";
    boton.type = "button";
    boton.dataset.title = diseno.nombre;
    boton.setAttribute("aria-label", `Ampliar ${diseno.nombre}`);

    const imagen = document.createElement("img");
    imagen.src = `../fotos/${diseno.imagen}`;
    imagen.alt = diseno.nombre;
    imagen.loading = "lazy";

    const zoom = document.createElement("span");
    zoom.className = "galeria-item__zoom";
    zoom.innerHTML =
            '<i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>';

    boton.append(imagen, zoom);

    const info = document.createElement("div");
    info.className = "galeria-item__info";

    const etiqueta = document.createElement("span");
    etiqueta.textContent = nombresCategoriasGaleria[diseno.categoria] || diseno.categoria;

    const titulo = document.createElement("h3");
    titulo.textContent = diseno.nombre;

    info.append(etiqueta, titulo);
    articulo.append(boton, info);

    return articulo;
}

// Si la carga falla o todavía no hay diseños en MySQL, se conservan las
// tarjetas estáticas existentes en el HTML como respaldo.
async function cargarGaleriaPublica() {
    const grid = document.getElementById("galeriaGrid");

    try {
        const respuesta = await fetch("/api/galeria");

        if (!respuesta.ok) {
            return;
        }

        const datos = await respuesta.json();
        const diseños = datos.galeria || [];

        if (!diseños.length) {
            return;
        }

        grid.replaceChildren(...diseños.map(crearTarjetaGaleria));
    } catch {
        // Sin conexión o error de red: se mantiene el contenido existente.
    }
}

// Filtros y visor ampliado: se enlazan después de renderizar para que
// funcionen igual tanto con las tarjetas dinámicas como con el respaldo.
function inicializarFiltrosYVisor() {
    const botonesFiltro = document.querySelectorAll(".filtro-btn");
    const mensajeVacio = document.getElementById("sinResultados");

    botonesFiltro.forEach((boton) => {
        boton.addEventListener("click", () => {
            const categoria = boton.dataset.filter;
            const tarjetas = document.querySelectorAll(".galeria-item");
            let cantidadVisible = 0;

            botonesFiltro.forEach((otroBoton) => {
                const seleccionado = otroBoton === boton;

                otroBoton.classList.toggle("active", seleccionado);
                otroBoton.setAttribute("aria-pressed", String(seleccionado));
            });

            tarjetas.forEach((tarjeta) => {
                const mostrar =
                        categoria === "todos" ||
                        tarjeta.dataset.category === categoria;

                tarjeta.hidden = !mostrar;

                if (mostrar) {
                    cantidadVisible++;
                }
            });

            mensajeVacio.hidden = cantidadVisible > 0;
        });
    });

    const visor = document.getElementById("visor");
    const visorImagen = document.getElementById("visorImagen");
    const visorTitulo = document.getElementById("visorTitulo");
    const cerrarVisor = document.getElementById("cerrarVisor");

    let elementoAnterior = null;

    function abrirVisor(boton) {
        elementoAnterior = boton;

        const imagen = boton.querySelector("img");

        visorImagen.src = imagen.src;
        visorImagen.alt = imagen.alt;
        visorTitulo.textContent = boton.dataset.title;

        visor.classList.add("visor--abierto");
        visor.setAttribute("aria-hidden", "false");
        document.body.classList.add("visor-activo");

        cerrarVisor.focus();
    }

    function ocultarVisor() {
        visor.classList.remove("visor--abierto");
        visor.setAttribute("aria-hidden", "true");
        document.body.classList.remove("visor-activo");

        visorImagen.src = "";

        if (elementoAnterior) {
            elementoAnterior.focus();
        }
    }

    // Delegado sobre el contenedor: funciona también con tarjetas que se
    // generan después de este punto (no hace falta volver a enlazar).
    document.getElementById("galeriaGrid").addEventListener("click", (evento) => {
        const boton = evento.target.closest(".galeria-item__imagen");

        if (boton) {
            abrirVisor(boton);
        }
    });

    cerrarVisor.addEventListener("click", ocultarVisor);

    visor.addEventListener("click", (evento) => {
        if (evento.target === visor) {
            ocultarVisor();
        }
    });

    document.addEventListener("keydown", (evento) => {
        if (
                evento.key === "Escape" &&
                visor.classList.contains("visor--abierto")
                ) {
            ocultarVisor();
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await cargarGaleriaPublica();
    inicializarFiltrosYVisor();
});
