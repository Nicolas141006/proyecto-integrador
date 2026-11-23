-- ============================================================
-- LAS DELICIAS DE GRA - BASE DE DATOS PARA INSTALACION
-- Requiere MySQL 8.0.16 o superior.
-- Importar en una base de datos nueva/vacia.
-- Este script NO elimina bases de datos ni tablas existentes.
-- Incluye catalogo de productos y galeria; no incluye usuarios,
-- pedidos, pagos, reseñas ni datos personales.
-- ============================================================

CREATE DATABASE IF NOT EXISTS `db_proy_integrador`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `db_proy_integrador`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Estructura de tabla: configuracion
CREATE TABLE `configuracion` (
  `id` tinyint NOT NULL,
  `datos_negocio` json DEFAULT NULL,
  `horarios` json DEFAULT NULL,
  `metodos_pago` json DEFAULT NULL,
  `condiciones_pedido` json DEFAULT NULL,
  `actualizado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_configuracion_id_unico` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: usuarios
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `celular` varchar(15) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `token_activacion_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `token_activacion_expira` timestamp NULL DEFAULT NULL,
  `intentos_activacion` int NOT NULL DEFAULT '0',
  `rol` enum('admin','cliente') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cliente',
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `celular` (`celular`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: productos
CREATE TABLE `productos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `categoria` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `imagen` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `precio` decimal(10,2) NOT NULL,
  `disponible` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `detalles` json DEFAULT NULL,
  `anticipacion` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pedido_minimo` int DEFAULT NULL,
  `unidad_venta` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidades_por_caja` int DEFAULT NULL,
  `presentaciones` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: galeria
CREATE TABLE `galeria` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `categoria` enum('cumpleanos','infantiles','eventos','elegantes') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `imagen` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: pedidos
CREATE TABLE `pedidos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int DEFAULT NULL,
  `nombre_cliente` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `celular_cliente` varchar(15) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo_entrega` enum('recojo','delivery') COLLATE utf8mb4_unicode_ci NOT NULL,
  `direccion_entrega` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_solicitada` date DEFAULT NULL,
  `hora_solicitada` time DEFAULT NULL,
  `estado` enum('pendiente','confirmado','entregado','cancelado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  `fecha_entregada` datetime DEFAULT NULL,
  `cancelado_en` datetime DEFAULT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT '0.00',
  `costo_delivery` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `estado_pago` enum('sin_pagar','adelanto','pagado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sin_pagar',
  `monto_adelanto` decimal(10,2) NOT NULL DEFAULT '0.00',
  `saldo_pendiente` decimal(10,2) GENERATED ALWAYS AS ((`total` - `monto_adelanto`)) VIRTUAL,
  `notas` text COLLATE utf8mb4_unicode_ci,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `origen` enum('web','whatsapp','llamada','presencial') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'web',
  PRIMARY KEY (`id`),
  KEY `fk_pedido_usuario` (`usuario_id`),
  CONSTRAINT `fk_pedido_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_estado_pago_coherente` CHECK ((((`estado_pago` = _utf8mb4'sin_pagar') and (`monto_adelanto` = 0)) or ((`estado_pago` = _utf8mb4'adelanto') and (`monto_adelanto` > 0) and (`monto_adelanto` < `total`)) or ((`estado_pago` = _utf8mb4'pagado') and (`monto_adelanto` = `total`))))
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: detalle_pedido
CREATE TABLE `detalle_pedido` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pedido_id` int NOT NULL,
  `producto_id` int DEFAULT NULL,
  `nombre_producto` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `presentacion` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cantidad` int NOT NULL,
  `precio_unitario` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_detalle_pedido` (`pedido_id`),
  KEY `fk_detalle_producto` (`producto_id`),
  CONSTRAINT `fk_detalle_pedido` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_detalle_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_cantidad_positiva` CHECK ((`cantidad` > 0))
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: entregas_fidelizacion
CREATE TABLE `entregas_fidelizacion` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `beneficio` enum('primera_compra','novena_compra') COLLATE utf8mb4_unicode_ci NOT NULL,
  `entregado` tinyint(1) NOT NULL DEFAULT '0',
  `entregado_en` timestamp NULL DEFAULT NULL,
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuario_beneficio` (`usuario_id`,`beneficio`),
  CONSTRAINT `fk_fidelizacion_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: movimientos_pago
CREATE TABLE `movimientos_pago` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pedido_id` int NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `metodo_pago` enum('yape','transferencia','efectivo','otro') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'efectivo',
  `referencia` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_pago` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_movimiento_pedido` (`pedido_id`),
  CONSTRAINT `fk_movimiento_pedido` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_monto_positivo` CHECK ((`monto` > 0))
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: pedido_adicionales
CREATE TABLE `pedido_adicionales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pedido_id` int NOT NULL,
  `nombre` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `precio` decimal(10,2) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_adicional_pedido` (`pedido_id`),
  CONSTRAINT `fk_adicional_pedido` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_precio_adicional_positivo` CHECK ((`precio` > 0))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Estructura de tabla: resenas
CREATE TABLE `resenas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `pedido_id` int NOT NULL,
  `producto_id` int NOT NULL,
  `calificacion` tinyint NOT NULL,
  `comentario` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fotografia` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` enum('pendiente','aprobada','oculta') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resena_pedido_producto` (`pedido_id`,`producto_id`),
  KEY `fk_resena_usuario` (`usuario_id`),
  KEY `fk_resena_producto` (`producto_id`),
  CONSTRAINT `fk_resena_pedido` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_resena_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_resena_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_calificacion_valida` CHECK ((`calificacion` between 1 and 5))
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;;

-- Configuracion inicial editable desde el panel de administracion.
-- Los datos de contacto se dejan vacios para que cada instalador
-- configure los datos de su propio negocio.
INSERT INTO `configuracion`
  (`id`, `datos_negocio`, `horarios`, `metodos_pago`, `condiciones_pedido`)
VALUES
  (1,
   JSON_OBJECT(
     'nombre', 'Las Delicias de Gra',
     'telefono', '',
     'whatsapp', '',
     'direccion', '',
     'redesSociales', JSON_OBJECT(
       'tiktok', '',
       'facebook', '',
       'instagram', ''
     )
   ),
   JSON_OBJECT(
     'dias', JSON_ARRAY('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'),
     'apertura', '09:00',
     'cierre', '20:00'
   ),
   JSON_OBJECT(),
   JSON_OBJECT());

-- Catalogo inicial de productos
INSERT INTO `productos` VALUES (1,'Selva Negra','selva-negra','tortas-clasicas','Una combinación clásica de chocolate para compartir en ocasiones especiales.','tortas/BlackForestDeluxe.png',95.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Chocolate\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Chantillín\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 95, \"1/2 kg\": 55}'),(2,'Torta de Zanahoria','torta-de-zanahoria','tortas-clasicas','Una torta de zanahoria con un estilo casero y una presentación especial.','tortas/CarrotDelight.png',85.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Zanahoria\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Buttercream suizo\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 85, \"1/2 kg\": 48}'),(3,'Chocolate Supremo','chocolate-supremo','tortas-clasicas','Una torta de chocolate pensada para los amantes de los sabores intensos.','tortas/ChocolateSupreme.png',100.00,1,'2026-10-24 03:25:28','2026-11-21 03:02:00','{\"Peso\": \"1 kg (14-18 porciones)\", \"Sabor\": \"Chocolate\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Buttercream suizo\"}','Solicitar con al menos 5 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 100, \"1/2 kg\": 60}'),(4,'Sueño de Coco','sueno-de-coco','tortas-clasicas','Una propuesta de sabor a coco para disfrutar en familia.','tortas/CoconutDream.png',90.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Coco\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Chantillín\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 90, \"1/2 kg\": 52}'),(5,'Cookies & Cream','cookies-and-cream','tortas-clasicas','Una combinación de galletas y crema con un toque especial.','tortas/Cookies&Cream.png',95.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Galletas y crema\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Buttercream suizo\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 95, \"1/2 kg\": 55}'),(6,'Especial de la Casa','especial-de-la-casa','tortas-clasicas','Una propuesta especial de Las Delicias de Gra.','tortas/DeliciasDeGraSignature.png',110.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Por definir según la receta\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Buttercream suizo\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 110, \"1/2 kg\": 65}'),(7,'Vainilla Dorada','vainilla-dorada','tortas-clasicas','Una propuesta clásica y delicada con sabor a vainilla.','tortas/GoldenVainilla.png',85.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Vainilla\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Chantillín\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 85, \"1/2 kg\": 48}'),(8,'Elegancia Marmoleada','elegancia-marmoleada','tortas-clasicas','Una combinación de vainilla y chocolate en una torta marmoleada.','tortas/MarbleElegance.png',90.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Vainilla y chocolate\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Buttercream suizo\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 90, \"1/2 kg\": 52}'),(9,'Moka Prestige','moka-prestige','tortas-clasicas','Una torta inspirada en la combinación de café y chocolate.','tortas/MokaPrestige.png',100.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Moka\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Buttercream suizo\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 100, \"1/2 kg\": 58}'),(10,'Torta Naranja','armonia-de-naranja','tortas-clasicas','Una alternativa con sabor cítrico a naranja.','tortas/OrangeHarmony.png',90.00,1,'2026-10-24 03:25:28','2026-11-21 01:26:17','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Naranja\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Chantillín\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 5 días de anticipación',1,'1',1,'{\"1 kg\": 85, \"1/2 kg\": 48}'),(11,'Paraíso de Piña','paraiso-de-pina','tortas-clasicas','Una torta con sabor a piña para disfrutar en cualquier ocasión.','tortas/PineAppleParadise.png',90.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Piña\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Chantillín\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 90, \"1/2 kg\": 52}'),(12,'Tres Leches Real','tres-leches-real','tortas-clasicas','Una torta inspirada en el clásico postre de tres leches.','tortas/RoyalTresLeches.png',100.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Tres leches\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Chantillín\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 100, \"1/2 kg\": 58}'),(13,'Delicia de Fresa','delicia-de-fresa','tortas-clasicas','Una propuesta con sabor a fresa y una presentación delicada.','tortas/StrawberryDelight.png',95.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Peso\": \"1 kg (12-16 porciones)\", \"Sabor\": \"Fresa\", \"Relleno\": \"Manjar blanco\", \"Cobertura\": \"Chantillín\", \"Decoración\": \"Completar según la fotografía\"}','Solicitar con al menos 4 días de anticipación',NULL,NULL,NULL,'{\"1 kg\": 95, \"1/2 kg\": 55}'),(14,'Berry Cheesecake','berry-cheesecake','postres','Cheesecake cremoso con una cubierta de frutos rojos.','postres/BerryCheesecake.png',75.00,0,'2026-10-24 03:25:28','2026-11-21 23:38:07','{\"Sabor\": \"Queso crema y frutos rojos\", \"Conservación\": \"Consultar según preparación\", \"Presentación\": \"Torta entera\"}',NULL,NULL,NULL,NULL,NULL),(15,'Tiramisú Clásico','tiramisu-clasico','postres','Postre clásico de capas cremosas con sabor a café.','postres/ClassicTiramisu.png',65.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Sabor\": \"Café y crema\", \"Conservación\": \"Consultar según preparación\", \"Presentación\": \"Postre entero para compartir\"}',NULL,NULL,NULL,NULL,NULL),(16,'Cuchareable','cuchareable','postres','Postre individual listo para disfrutar con cuchara.','postres/Cuchareable.png',10.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Presentación\": \"Unidad individual\", \"Pedido mínimo\": \"5 unidades\", \"precioPorUnidad\": true, \"Precio por unidad\": \"S/ 10.00\"}',NULL,5,NULL,NULL,NULL),(17,'Golden Apple Pie','golden-apple-pie','postres','Pie de manzana con una cubierta dorada y crujiente.','postres/GoldenApplepie.png',45.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Sabor\": \"Manzana y canela\", \"Conservación\": \"Consultar según preparación\", \"Presentación\": \"Pie entero\"}',NULL,NULL,NULL,NULL,NULL),(18,'Pie de Limón','pie-de-limon','postres','Pie con crema de limón y una delicada cubierta.','postres/LemonPie.png',45.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Sabor\": \"Limón\", \"Conservación\": \"Consultar según preparación\", \"Presentación\": \"Pie entero\"}',NULL,NULL,NULL,NULL,NULL),(19,'Caja de Tartas de Frutas','caja-de-tartas-de-frutas','postres','Caja de seis tartaletas con opciones de fresa, durazno o una combinación de ambas.','postres/MixedFruitTartbox.png',28.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Opciones\": \"Mixta, full fresa o full durazno\", \"Presentación\": \"Caja de 6 tartaletas\", \"Pedido mínimo\": \"1 caja\", \"opcionesPresentacion\": [\"Caja de 6 - mixto\", \"Caja de 6 - full fresa\", \"Caja de 6 - full durazno\"], \"Precio de cualquiera de las opciones\": \"S/ 28.00\"}',NULL,1,'caja',NULL,'{\"opciones\": [\"Caja de 6 - mixto\", \"Caja de 6 - full fresa\", \"Caja de 6 - full durazno\"]}'),(20,'Oreo Cheesecake','oreo-cheesecake','postres','Cheesecake cremoso inspirado en el sabor de las galletas Oreo.','postres/OreoCheesecake.png',75.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Sabor\": \"Galletas Oreo y queso crema\", \"Conservación\": \"Consultar según preparación\", \"Presentación\": \"Torta entera\"}',NULL,NULL,NULL,NULL,NULL),(21,'Passion Cheesecake','passion-cheesecake','postres','Cheesecake con una cubierta de maracuyá de sabor frutal.','postres/PassionCheesecake.png',75.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Sabor\": \"Maracuyá y queso crema\", \"Conservación\": \"Consultar según preparación\", \"Presentación\": \"Torta entera\"}',NULL,NULL,NULL,NULL,NULL),(22,'Peach Blossom Tart','peach-blossom-tart','postres','Tartaletas delicadas con durazno y una presentación especial.','postres/PeachBlossomTart.png',28.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Presentación\": \"Caja de 6 tartaletas\", \"Pedido mínimo\": \"1 caja\", \"Precio por caja\": \"S/ 28.00\"}',NULL,1,'caja',NULL,NULL),(23,'Caja de Pie y Alfajores','caja-de-pie-y-alfajores','postres','Caja de seis unidades a elegir entre pies, alfajores o una combinación de ambos.','postres/PieAndAlfajorBox.png',26.00,1,'2026-10-24 03:25:28','2026-11-21 01:49:28','{\"Opciones\": \"6 pies, 6 alfajores o caja mixta\", \"Presentación\": \"Caja de 6 unidades\", \"Pedido mínimo\": \"1 caja\", \"opcionesPresentacion\": [\"Caja de 6 - pie\", \"Caja de 6 - alfajor\", \"Caja de 6 - mixto\"], \"Precio de cualquiera de las opciones\": \"S/ 26.00\"}',NULL,1,'caja',NULL,'{\"opciones\": [\"Caja de 6 - pie\", \"Caja de 6 - alfajor\", \"Caja de 6 - mixto\"]}'),(24,'Tarta de Fresa','tarta-de-fresa','postres','Tartaletas de fresa con una presentación delicada.','postres/StrawBerryTart.png',28.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Presentación\": \"Caja de 6 tartaletas\", \"Pedido mínimo\": \"1 caja\", \"Precio por caja\": \"S/ 28.00\"}',NULL,1,'caja',NULL,NULL),(25,'Empanada de Carne','empanada-de-carne','postres','Empanadas de carne preparadas para compartir.','postres/MeatEmpanada.png',12.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Presentación\": \"Caja de 3 unidades\", \"Pedido mínimo\": \"1 cajas\", \"Precio por caja\": \"S/ 12.00\", \"precioPorUnidadVenta\": 12}',NULL,1,'caja',3,NULL),(26,'Alfajor de Chocolate','alfajor-de-chocolate','bocaditos','Alfajor de chocolate ideal para reuniones y celebraciones.','bocaditos/ChocolateAlfajor.png',75.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 75.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(27,'Alfajor Clásico','alfajor-clasico','bocaditos','Alfajores clásicos para compartir en ocasiones especiales.','bocaditos/ClassicAlfajor.png',65.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 65.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(28,'Apple Pie Clásico','apple-pie-clasico','bocaditos','Bocaditos de pie de manzana con una cubierta dorada.','bocaditos/ClassicApplePie.png',70.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 70.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(29,'Brownie Clásico','brownie-clasico','bocaditos','Brownies de chocolate ideales para reuniones y celebraciones.','bocaditos/ClassicBrownie.png',65.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 65.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(30,'Empanada de Carne Clásica','empanada-de-carne-clasica','bocaditos','Empanadas de carne horneadas, ideales para compartir.','bocaditos/ClassicMeatEmpanada.png',12.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Presentación\": \"Caja de 3 unidades\", \"Pedido mínimo\": \"2 cajas\", \"Precio por caja\": \"S/ 12.00\", \"precioPorUnidadVenta\": 12}',NULL,2,'caja',3,NULL),(31,'Pionono Clásico','pionono-clasico','bocaditos','Piononos clásicos para compartir en reuniones y celebraciones.','bocaditos/ClassicPionono.png',70.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 70.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(32,'Mini Tarta de Durazno','mini-tarta-de-durazno','bocaditos','Mini tartas de durazno con una presentación delicada.','bocaditos/PeachMiniTart.png',75.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 75.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(33,'Alfajor Especial','alfajor-especial','bocaditos','Alfajores especiales preparados para ocasiones especiales.','bocaditos/SignatureAlfajor.png',75.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 75.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(34,'Mini Tarta de Fresa','mini-tarta-de-fresa','bocaditos','Mini tartas de fresa con una presentación delicada.','bocaditos/StrawberryMiniTart.png',75.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Precio\": \"S/ 75.00\", \"Presentación\": \"50 unidades\", \"cantidadPresentacion\": 50}',NULL,NULL,NULL,NULL,NULL),(35,'Keke de Arándanos','keke-de-arandanos','kekes-caseros','Keke casero con arándanos.','kekes/KekeArandanos.png',50.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(36,'Keke de Chocolate con Chispas','keke-de-chocolate-con-chispas','kekes-caseros','Keke de chocolate con chispas.','kekes/KekeChocolateChispas.png',45.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(37,'Keke de Chocomenta','keke-de-chocomenta','kekes-caseros','Una combinación de chocolate y menta.','kekes/KekeChocomenta.png',48.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(38,'Keke de Fresa','keke-de-fresa','kekes-caseros','Keke casero con sabor a fresa.','kekes/KekeFresa.png',42.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(39,'Keke de Mandarina','keke-de-mandarina','kekes-caseros','Keke casero con sabor cítrico.','kekes/KekeMandarina.png',40.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(40,'Keke de Maracuyá','keke-de-maracuya','kekes-caseros','Keke casero con sabor a maracuyá.','kekes/KekeMaracuya.png',45.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(41,'Keke Marmoleado','keke-marmoleado','kekes-caseros','Una combinación de vainilla y chocolate.','kekes/KekeMarmoleado.png',42.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(42,'Keke de Naranja','keke-de-naranja','kekes-caseros','Keke casero con sabor a naranja.','kekes/KekeNaranja.png',40.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(43,'Keke de Plátano','keke-de-platano','kekes-caseros','Keke casero con sabor a plátano.','kekes/KekePlatano.png',42.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(44,'Keke de Plátano con Pecanas','keke-de-platano-con-pecanas','kekes-caseros','Keke de plátano con pecanas.','kekes/KekePlatanoPecanas.png',50.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(45,'Keke de Vainilla','keke-de-vainilla','kekes-caseros','Keke casero de vainilla.','kekes/KekeVainilla.png',40.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(46,'Keke de Vainilla con Chispas','keke-de-vainilla-con-chispas','kekes-caseros','Keke de vainilla con chispas.','kekes/KekeVainillaChispas.png',45.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(47,'Keke de Vainilla con Frutos Secos','keke-de-vainilla-con-frutos-secos','kekes-caseros','Keke de vainilla con frutos secos.','kekes/KekeVainillaFrutosSecos.png',52.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL),(48,'Keke de Zanahoria','keke-de-zanahoria','kekes-caseros','Keke casero con zanahoria.','kekes/KekeZanahoria.png',45.00,1,'2026-10-24 03:25:28','2026-10-24 03:25:28','{\"Conservación\": \"Dura 3 días esponjoso\", \"Presentación\": \"Molde entero de 1 kg\"}',NULL,NULL,NULL,NULL,NULL);

-- Galeria inicial
INSERT INTO `galeria` VALUES (1,'Birthday Celebration Cake','cumpleanos','galeria/BirthdayCelebrationCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:09:41'),(2,'Blooming Celebration','eventos','galeria/BloomingCelebration.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(3,'Blooming Elegance','elegantes','galeria/BloomingElegance.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(4,'Blue Sonic Party','infantiles','galeria/BlueSonicParty.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(5,'Blue Victory Cake','cumpleanos','galeria/BlueVictoryCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(6,'Gentleman Whiskey Cake','elegantes','galeria/GentlemanWhiskeyCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(7,'Golden Butterfly Cake','cumpleanos','galeria/GoldenButterflyCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(8,'Golden Crown Cake','cumpleanos','galeria/GoldenCrownCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(9,'Golden Unity Cake','cumpleanos','galeria/GoldenUnityCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(10,'Graduation Celebration','eventos','galeria/GraduationCelebration.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(11,'Jungle Baby Shower','eventos','galeria/JungleBabyShower.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(12,'Little Bear Cake','eventos','galeria/LittleBearCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(13,'Little Dream Cake','infantiles','galeria/LittleDreamCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(14,'Moon Dreams Cake','cumpleanos','galeria/MoonDreamsCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(15,'Pink Blossom Cake','infantiles','galeria/PinkBlossomCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(16,'Pink Lily Elegance','cumpleanos','galeria/PinkLilyElegance.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(17,'Pink Royal','elegantes','galeria/PinkRoyal.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(18,'Romantic Moments Cake','cumpleanos','galeria/RomanticMomentsCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(19,'Royal Blue Cake','cumpleanos','galeria/RoyalBlueCake.png',1,'2026-11-22 01:06:22','2026-11-22 01:06:22'),(20,'Moana Cake','infantiles','galeria/ca48880ff8ca7723c4cc9c5cc417d92b.jpg',0,'2026-11-22 01:10:05','2026-11-23 00:33:26');

SET FOREIGN_KEY_CHECKS = 1;
-- Instalacion finalizada.
-- Crear/configurar la cuenta administradora siguiendo las instrucciones
-- de instalacion del proyecto. No se distribuyen credenciales personales.
