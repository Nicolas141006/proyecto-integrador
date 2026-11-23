// Conecta los datos del negocio y los horarios (administrados desde el panel)
// con las páginas públicas de la tienda. Si un campo llega vacío o la
// solicitud falla, no se toca el elemento: así nunca se muestra un enlace
// roto ni un dato en blanco, se conserva el contenido que ya trae el HTML.

const CODIGO_PAIS_TELEFONO = "51";

// Se inicia de inmediato (no espera al DOM) para que otras páginas, como el
// carrito, puedan reutilizar esta misma promesa sin pedir el recurso de nuevo.
window.configuracionPublica = fetch("/api/configuracion")
        .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
        .catch(() => null);

const NOMBRES_DIAS = {
    lunes: "Lunes",
    martes: "Martes",
    miercoles: "Miércoles",
    jueves: "Jueves",
    viernes: "Viernes",
    sabado: "Sábado",
    domingo: "Domingo"
};

const ORDEN_DIAS = [
    "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"
];

function formatearRangoDias(dias) {
    if (!Array.isArray(dias) || dias.length === 0) {
        return "";
    }

    if (dias.length === 7) {
        return "Lunes a domingo";
    }

    const indices = dias
            .map((dia) => ORDEN_DIAS.indexOf(dia))
            .filter((indice) => indice !== -1)
            .sort((a, b) => a - b);

    if (indices.length === 0) {
        return "";
    }

    const esContiguo = indices.every(
            (indice, posicion) => posicion === 0 || indice === indices[posicion - 1] + 1
            );

    if (esContiguo && indices.length > 1) {
        const primero = NOMBRES_DIAS[ORDEN_DIAS[indices[0]]];
        const ultimo = NOMBRES_DIAS[ORDEN_DIAS[indices[indices.length - 1]]].toLowerCase();
        return `${primero} a ${ultimo}`;
    }

    const etiquetas = indices.map((indice) => NOMBRES_DIAS[ORDEN_DIAS[indice]]);

    if (etiquetas.length === 1) {
        return etiquetas[0];
    }

    return etiquetas.slice(0, -1).join(", ") + " y " + etiquetas[etiquetas.length - 1];
}

function formatearHora12(horaTexto) {
    if (!horaTexto || !/^\d{1,2}:\d{2}$/.test(horaTexto)) {
        return "";
    }

    const [horas, minutos] = horaTexto.split(":").map(Number);
    const periodo = horas < 12 ? "a. m." : "p. m.";
    const horas12 = horas % 12 === 0 ? 12 : horas % 12;

    return `${horas12}:${String(minutos).padStart(2, "0")} ${periodo}`;
}

function formatearTelefonoLocal(telefono) {
    const digitos = String(telefono || "").replace(/\D/g, "");

    if (digitos.length !== 9) {
        return telefono || "";
    }

    return `${digitos.slice(0, 3)} ${digitos.slice(3, 6)} ${digitos.slice(6)}`;
}

function aplicarTexto(selector, valor) {
    if (!valor) {
        return;
    }

    document.querySelectorAll(selector).forEach((elemento) => {
        elemento.textContent = valor;
    });
}

function aplicarEnlace(selector, href) {
    if (!href) {
        return;
    }

    document.querySelectorAll(selector).forEach((elemento) => {
        elemento.setAttribute("href", href);
    });
}

// Algunos enlaces de WhatsApp ya traen un mensaje precargado (?text=...).
// Se actualiza solo el número y se conserva ese mensaje tal cual.
function aplicarEnlaceWhatsapp(selector, numero) {
    if (!numero) {
        return;
    }

    document.querySelectorAll(selector).forEach((elemento) => {
        let busqueda = "";

        try {
            busqueda = new URL(elemento.getAttribute("href"), window.location.href).search;
        } catch {
            busqueda = "";
        }

        elemento.setAttribute("href", `https://wa.me/${numero}${busqueda}`);
    });
}

function aplicarConfiguracionPublica(datos) {
    if (!datos) {
        return;
    }

    const negocio = datos.datosNegocio || {};
    const horarios = datos.horarios || {};

    if (negocio.telefono) {
        aplicarEnlace(
                '[data-config="telefono-href"]',
                `tel:+${CODIGO_PAIS_TELEFONO}${negocio.telefono}`
                );
        aplicarTexto('[data-config="telefono-texto"]', formatearTelefonoLocal(negocio.telefono));
    }

    if (negocio.whatsapp) {
        aplicarEnlaceWhatsapp('[data-config="whatsapp-href"]', negocio.whatsapp);
    }

    if (negocio.direccion) {
        aplicarTexto('[data-config="direccion-texto"]', negocio.direccion);
    }

    if (negocio.mapsUrl) {
        aplicarEnlace('[data-config="maps-href"]', negocio.mapsUrl);
    }

    if (negocio.redesSociales?.facebook) {
        aplicarEnlace('[data-config="facebook-href"]', negocio.redesSociales.facebook);
    }

    if (negocio.redesSociales?.instagram) {
        aplicarEnlace('[data-config="instagram-href"]', negocio.redesSociales.instagram);
    }

    const rangoDias = formatearRangoDias(horarios.dias);
    const horaApertura = formatearHora12(horarios.apertura);
    const horaCierre = formatearHora12(horarios.cierre);

    if (rangoDias) {
        aplicarTexto('[data-config="horario-dias"]', rangoDias);
    }

    if (horaApertura && horaCierre) {
        aplicarTexto('[data-config="horario-horas"]', `${horaApertura} – ${horaCierre}`);
    }

    if (rangoDias && horaApertura && horaCierre) {
        aplicarTexto(
                '[data-config="horario-combinado"]',
                `${rangoDias}, de ${horaApertura} a ${horaCierre}`
                );
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const datos = await window.configuracionPublica;
    aplicarConfiguracionPublica(datos);
});
