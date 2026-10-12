
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `autorizaciones_pin`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `autorizaciones_pin` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token` char(36) NOT NULL,
  `supervisor_id` int NOT NULL,
  `solicitado_por` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `usada_por` int DEFAULT NULL,
  `usada_en` datetime DEFAULT NULL,
  `pesaje_id` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_autorizaciones_pin_token` (`token`),
  UNIQUE KEY `uq_autorizaciones_pin_pesaje` (`pesaje_id`),
  KEY `fk_autorizaciones_pin_supervisor` (`supervisor_id`),
  KEY `fk_autorizaciones_pin_solicitado_por` (`solicitado_por`),
  KEY `fk_autorizaciones_pin_usada_por` (`usada_por`),
  CONSTRAINT `fk_autorizaciones_pin_pesaje` FOREIGN KEY (`pesaje_id`) REFERENCES `pesajes` (`id`),
  CONSTRAINT `fk_autorizaciones_pin_solicitado_por` FOREIGN KEY (`solicitado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_autorizaciones_pin_supervisor` FOREIGN KEY (`supervisor_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_autorizaciones_pin_usada_por` FOREIGN KEY (`usada_por`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `bitacora`;
/*!50001 DROP VIEW IF EXISTS `bitacora`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `bitacora` AS SELECT 
 1 AS `entidad`,
 1 AS `entidad_id`,
 1 AS `entidad_nombre`,
 1 AS `accion`,
 1 AS `motivo`,
 1 AS `cliente_id`,
 1 AS `cliente`,
 1 AS `usuario_id`,
 1 AS `usuario`,
 1 AS `usuario_rol`,
 1 AS `ocurrio_en`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `catalogo_permisos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `catalogo_permisos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(100) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_catalogo_permisos_codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `conversacion` char(36) DEFAULT NULL,
  `mensaje` text,
  `herramientas` json DEFAULT NULL,
  `respuesta` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_log_usuario_fecha` (`usuario_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cliente_operador`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cliente_operador` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cliente_operador` (`cliente_id`,`usuario_id`),
  KEY `fk_cliente_operador_usuario` (`usuario_id`),
  CONSTRAINT `fk_cliente_operador_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `fk_cliente_operador_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `clientes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clientes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL COMMENT 'Nombre de la empresa o productor comercial',
  `rtn` varchar(20) NOT NULL COMMENT 'Registro Tributario Nacional para facturación',
  `producto_id` int DEFAULT NULL,
  `codigo_exportacion` varchar(50) DEFAULT NULL COMMENT 'Registro sanitario, aduanero o de trazabilidad sectorial',
  `correo_contacto` varchar(100) DEFAULT NULL COMMENT 'Para envío automático de reportes de pesaje / IA',
  `telefono` varchar(20) DEFAULT NULL,
  `direccion_planta` text COMMENT 'Dirección física de origen del producto',
  `constancia_exonerado` varchar(50) DEFAULT NULL,
  `ubicacionLongitud` varchar(100) DEFAULT NULL,
  `ubicacionLatitude` varchar(100) DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()),
  `motivo_rechazo` varchar(255) DEFAULT NULL,
  `rechazado_por` int DEFAULT NULL,
  `rechazado_en` datetime DEFAULT NULL,
  `created_by` int DEFAULT NULL COMMENT 'Usuario que registró al cliente',
  PRIMARY KEY (`id`),
  UNIQUE KEY `rtn` (`rtn`),
  UNIQUE KEY `codigo_exportacion` (`codigo_exportacion`),
  KEY `created_by` (`created_by`),
  KEY `fk_clientes_producto` (`producto_id`),
  KEY `fk_clientes_rechazado_por` (`rechazado_por`),
  CONSTRAINT `clientes_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_clientes_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `fk_clientes_rechazado_por` FOREIGN KEY (`rechazado_por`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `documento_fiscal_impuesto`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `documento_fiscal_impuesto` (
  `id` int NOT NULL AUTO_INCREMENT,
  `documento_id` int NOT NULL,
  `tarifa` decimal(5,2) NOT NULL,
  `base_gravada` decimal(14,2) NOT NULL,
  `impuesto` decimal(14,2) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_tarifa` (`documento_id`,`tarifa`),
  CONSTRAINT `fk_dfi_doc` FOREIGN KEY (`documento_id`) REFERENCES `documentos_fiscales` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `documento_fiscal_lote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `documento_fiscal_lote` (
  `id` int NOT NULL AUTO_INCREMENT,
  `documento_id` int NOT NULL,
  `lote_id` int NOT NULL,
  `cantidad` decimal(14,4) NOT NULL,
  `unidad_medida_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_lote` (`documento_id`,`lote_id`),
  KEY `fk_dfl_lote` (`lote_id`),
  KEY `fk_dfl_unidad` (`unidad_medida_id`),
  CONSTRAINT `fk_dfl_doc` FOREIGN KEY (`documento_id`) REFERENCES `documentos_fiscales` (`id`),
  CONSTRAINT `fk_dfl_lote` FOREIGN KEY (`lote_id`) REFERENCES `lotes` (`id`),
  CONSTRAINT `fk_dfl_unidad` FOREIGN KEY (`unidad_medida_id`) REFERENCES `unidades_medida` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `documentos_fiscales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `documentos_fiscales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pais_id` int NOT NULL,
  `cliente_id` int NOT NULL,
  `tipo_documento` varchar(20) NOT NULL,
  `numero_completo` varchar(50) NOT NULL,
  `autorizacion` varchar(100) DEFAULT NULL,
  `fecha_emision` date NOT NULL,
  `moneda` char(3) NOT NULL,
  `tipo_cambio` decimal(14,6) NOT NULL DEFAULT '1.000000',
  `importe_exento` decimal(14,2) NOT NULL DEFAULT '0.00',
  `importe_exonerado` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total` decimal(14,2) NOT NULL,
  `referencia_exencion` varchar(50) DEFAULT NULL,
  `pais_destino` char(2) DEFAULT NULL,
  `documento_aduanero` varchar(50) DEFAULT NULL,
  `archivo_url` varchar(255) DEFAULT NULL,
  `motivo_anulacion` varchar(255) DEFAULT NULL,
  `anulado_por` int DEFAULT NULL,
  `anulado_en` datetime DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_numero` (`pais_id`,`numero_completo`),
  KEY `fk_doc_cliente` (`cliente_id`),
  KEY `fk_doc_creador` (`created_by`),
  KEY `fk_doc_anulador` (`anulado_por`),
  CONSTRAINT `fk_doc_anulador` FOREIGN KEY (`anulado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_doc_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `fk_doc_creador` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_doc_pais` FOREIGN KEY (`pais_id`) REFERENCES `paises_config` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estados_calidad`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `estados_calidad` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(15) NOT NULL COMMENT 'Ej: BAJO, IDEAL, SOBREPESO',
  `nombre` varchar(50) NOT NULL COMMENT 'Ej: Peso Bajo, Peso Ideal, Sobrepeso',
  `created_at` timestamp NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `etapas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `etapas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(50) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `log_errores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `log_errores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `status` smallint NOT NULL,
  `metodo` varchar(10) NOT NULL,
  `ruta` varchar(500) NOT NULL,
  `mensaje` varchar(1000) NOT NULL,
  `stack` text,
  `usuario_id` int DEFAULT NULL,
  `entorno` varchar(20) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `lotes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lotes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `nombre_lote` varchar(50) NOT NULL COMMENT 'Código único. Ej: OKRA-2026-07-A',
  `producto_id` int NOT NULL COMMENT 'Llave foránea al catálogo de productos',
  `variedad_o_talla` varchar(50) DEFAULT NULL COMMENT 'Ej: Okra American / Camarón 41/50',
  `unidad_medida_id` int NOT NULL COMMENT 'Llave foránea al catálogo de unidades',
  `etapa_id` int DEFAULT NULL,
  `peso_minimo` decimal(10,2) NOT NULL COMMENT 'Límite inferior para rechazo',
  `peso_ideal` decimal(10,2) NOT NULL COMMENT 'Peso objetivo del empaque',
  `peso_maximo` decimal(10,2) NOT NULL COMMENT 'Límite superior para rechazo',
  `estado` varchar(20) DEFAULT 'abierto' COMMENT 'abierto, cerrado, en_pausa',
  `resumen_ia` text COMMENT 'Análisis generado por Gemini 1.5 Flash',
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()),
  `motivo_rechazo` varchar(255) DEFAULT NULL,
  `rechazado_por` int DEFAULT NULL,
  `rechazado_en` datetime DEFAULT NULL,
  `aprobado_por` int DEFAULT NULL,
  `aprobado_en` datetime DEFAULT NULL,
  `finalizado_por` int DEFAULT NULL,
  `finalizado_en` datetime DEFAULT NULL,
  `firma_aprobador` mediumtext,
  `cerrado_en` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `cliente_id` (`cliente_id`),
  KEY `producto_id` (`producto_id`),
  KEY `unidad_medida_id` (`unidad_medida_id`),
  KEY `created_by` (`created_by`),
  KEY `nombre_lote` (`nombre_lote`) USING BTREE,
  KEY `fk_lotes_etapa` (`etapa_id`),
  KEY `fk_lotes_rechazado_por` (`rechazado_por`),
  KEY `fk_lotes_aprobado_por` (`aprobado_por`),
  KEY `fk_lotes_finalizado_por` (`finalizado_por`),
  CONSTRAINT `fk_lotes_aprobado_por` FOREIGN KEY (`aprobado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_lotes_etapa` FOREIGN KEY (`etapa_id`) REFERENCES `etapas` (`id`),
  CONSTRAINT `fk_lotes_finalizado_por` FOREIGN KEY (`finalizado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_lotes_rechazado_por` FOREIGN KEY (`rechazado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `lotes_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `lotes_ibfk_2` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`),
  CONSTRAINT `lotes_ibfk_3` FOREIGN KEY (`unidad_medida_id`) REFERENCES `unidades_medida` (`id`),
  CONSTRAINT `lotes_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `paises_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `paises_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo_pais` char(2) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `moneda` char(3) NOT NULL,
  `etiqueta_autorizacion` varchar(40) NOT NULL,
  `etiqueta_identificacion` varchar(40) NOT NULL,
  `patron_numero` varchar(255) DEFAULT NULL,
  `patron_autorizacion` varchar(255) DEFAULT NULL,
  `requiere_autorizacion` tinyint(1) NOT NULL DEFAULT '1',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pais` (`codigo_pais`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `permisos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permisos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `rol_id` int NOT NULL,
  `permiso_id` int NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permisos_rol_permiso` (`rol_id`,`permiso_id`),
  KEY `fk_permisos_permiso` (`permiso_id`),
  CONSTRAINT `fk_permisos_permiso` FOREIGN KEY (`permiso_id`) REFERENCES `catalogo_permisos` (`id`),
  CONSTRAINT `fk_permisos_rol` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pesajes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pesajes` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Soporta miles de millones de registros (BigInt)',
  `lote_id` int NOT NULL,
  `codigo_tarima` varchar(50) DEFAULT NULL,
  `usuario_id` int NOT NULL COMMENT 'Operador que capturó el pesaje',
  `estado_calidad_id` int NOT NULL COMMENT 'Vínculo al catálogo de estados',
  `peso_bruto` decimal(10,2) NOT NULL COMMENT 'Lectura directa de la báscula OHAUS',
  `tara` decimal(10,2) DEFAULT '0.00' COMMENT 'Peso del contenedor, pallet o caja',
  `peso_neto` decimal(10,2) NOT NULL COMMENT 'Calculado en Backend (peso_bruto - tara)',
  `fuera_de_rango` tinyint(1) DEFAULT '0',
  `motivo_rechazo` varchar(255) DEFAULT NULL,
  `rechazado_por` int DEFAULT NULL,
  `rechazado_en` datetime DEFAULT NULL,
  `aprobado` tinyint(1) DEFAULT NULL,
  `aprobado_por` int DEFAULT NULL,
  `aprobado_en` datetime DEFAULT NULL,
  `aprobado_con_excepcion_por` int DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1' COMMENT 'Falso si el pesaje fue anulado o descartado',
  `dispositivo_identificador` varchar(50) DEFAULT NULL COMMENT 'MAC, IP o ID de la PC/Estación que corre React',
  `secuencia_dispositivo` int DEFAULT NULL COMMENT 'Contador correlativo local del puerto serial',
  `created_at` timestamp NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `lote_id` (`lote_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `estado_calidad_id` (`estado_calidad_id`),
  KEY `fk_pesajes_rechazado_por` (`rechazado_por`),
  KEY `fk_pesajes_aprobado_por` (`aprobado_por`),
  KEY `fk_pesajes_aprobado_con_excepcion_por` (`aprobado_con_excepcion_por`),
  CONSTRAINT `fk_pesajes_aprobado_con_excepcion_por` FOREIGN KEY (`aprobado_con_excepcion_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_pesajes_aprobado_por` FOREIGN KEY (`aprobado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_pesajes_rechazado_por` FOREIGN KEY (`rechazado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `pesajes_ibfk_1` FOREIGN KEY (`lote_id`) REFERENCES `lotes` (`id`),
  CONSTRAINT `pesajes_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `pesajes_ibfk_3` FOREIGN KEY (`estado_calidad_id`) REFERENCES `estados_calidad` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pines_supervisor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pines_supervisor` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `pin` char(4) NOT NULL,
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pines_supervisor_usuario` (`usuario_id`),
  UNIQUE KEY `uq_pines_supervisor_pin` (`pin`),
  KEY `fk_pines_supervisor_created_by` (`created_by`),
  CONSTRAINT `fk_pines_supervisor_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_pines_supervisor_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `productos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `productos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL COMMENT 'Ej: Okra, Melón, Camarón',
  `codigo_upc` varchar(50) DEFAULT NULL COMMENT 'Código de barras universal si aplica',
  `descripcion` varchar(150) DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  UNIQUE KEY `codigo_upc` (`codigo_upc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(30) NOT NULL COMMENT 'Ej: operator, supervisor, admin',
  `descripcion` varchar(150) DEFAULT NULL COMMENT 'Detalle de los accesos que permite este rol',
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()),
  `created_by` int DEFAULT NULL COMMENT 'Apunta al id del usuario que lo creó',
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `roles_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `unidades_medida`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unidades_medida` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(10) NOT NULL COMMENT 'Ej: lb, kg, g, oz',
  `nombre` varchar(50) NOT NULL COMMENT 'Ej: Libras, Kilogramos, Gramos',
  `created_at` timestamp NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'Llave primaria numérica autoincrementable',
  `username` varchar(20) DEFAULT NULL COMMENT 'Ej: SDAVILA',
  `complete_name` varchar(100) NOT NULL,
  `rol_id` int NOT NULL COMMENT 'Llave foránea que apunta al catálogo de roles',
  `password` varchar(255) NOT NULL COMMENT 'contrasena',
  `password_vence_en` datetime DEFAULT NULL,
  `password_actualizada_en` datetime DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()),
  `created_by` int DEFAULT NULL COMMENT 'Apunta al id del usuario que lo creó',
  `cedula` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `rol_id` (`rol_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `usuarios_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50001 DROP VIEW IF EXISTS `bitacora`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50001 VIEW `bitacora` (`entidad`,`entidad_id`,`entidad_nombre`,`accion`,`motivo`,`cliente_id`,`cliente`,`usuario_id`,`usuario`,`usuario_rol`,`ocurrio_en`) AS select `ev`.`entidad` AS `entidad`,`ev`.`entidad_id` AS `entidad_id`,`ev`.`entidad_nombre` AS `entidad_nombre`,`ev`.`accion` AS `accion`,`ev`.`motivo` AS `motivo`,`ev`.`cliente_id` AS `cliente_id`,`cl`.`nombre` AS `nombre`,`ev`.`usuario_id` AS `usuario_id`,`u`.`complete_name` AS `complete_name`,`r`.`nombre` AS `nombre`,`ev`.`ocurrio_en` AS `ocurrio_en` from ((((select 'cliente' AS `entidad`,`c`.`id` AS `entidad_id`,`c`.`nombre` AS `entidad_nombre`,'CREAR' AS `accion`,NULL AS `motivo`,`c`.`id` AS `cliente_id`,`c`.`created_by` AS `usuario_id`,`c`.`created_at` AS `ocurrio_en` from `clientes` `c` union all select 'cliente' AS `cliente`,`c`.`id` AS `id`,`c`.`nombre` AS `nombre`,'RECHAZAR' AS `RECHAZAR`,`c`.`motivo_rechazo` AS `motivo_rechazo`,`c`.`id` AS `id`,`c`.`rechazado_por` AS `rechazado_por`,`c`.`rechazado_en` AS `rechazado_en` from `clientes` `c` where (`c`.`rechazado_en` is not null) union all select 'lote' AS `lote`,`l`.`id` AS `id`,`l`.`nombre_lote` AS `nombre_lote`,'CREAR' AS `CREAR`,NULL AS `NULL`,`l`.`cliente_id` AS `cliente_id`,`l`.`created_by` AS `created_by`,`l`.`created_at` AS `created_at` from `lotes` `l` union all select 'lote' AS `lote`,`l`.`id` AS `id`,`l`.`nombre_lote` AS `nombre_lote`,'RECHAZAR' AS `RECHAZAR`,`l`.`motivo_rechazo` AS `motivo_rechazo`,`l`.`cliente_id` AS `cliente_id`,`l`.`rechazado_por` AS `rechazado_por`,`l`.`rechazado_en` AS `rechazado_en` from `lotes` `l` where (`l`.`rechazado_en` is not null) union all select 'lote' AS `lote`,`l`.`id` AS `id`,`l`.`nombre_lote` AS `nombre_lote`,'APROBAR' AS `APROBAR`,NULL AS `NULL`,`l`.`cliente_id` AS `cliente_id`,`l`.`aprobado_por` AS `aprobado_por`,`l`.`aprobado_en` AS `aprobado_en` from `lotes` `l` where (`l`.`aprobado_en` is not null) union all select 'pesaje' AS `pesaje`,`p`.`id` AS `id`,concat(`lp`.`nombre_lote`,' / ',`p`.`peso_neto`) AS `CONCAT(lp.nombre_lote, ' / ', p.peso_neto)`,'CREAR' AS `CREAR`,NULL AS `NULL`,`lp`.`cliente_id` AS `cliente_id`,`p`.`usuario_id` AS `usuario_id`,`p`.`created_at` AS `created_at` from (`pesajes` `p` join `lotes` `lp` on((`lp`.`id` = `p`.`lote_id`))) union all select 'pesaje' AS `pesaje`,`p`.`id` AS `id`,concat(`lp`.`nombre_lote`,' / ',`p`.`peso_neto`) AS `CONCAT(lp.nombre_lote, ' / ', p.peso_neto)`,'RECHAZAR' AS `RECHAZAR`,`p`.`motivo_rechazo` AS `motivo_rechazo`,`lp`.`cliente_id` AS `cliente_id`,`p`.`rechazado_por` AS `rechazado_por`,`p`.`rechazado_en` AS `rechazado_en` from (`pesajes` `p` join `lotes` `lp` on((`lp`.`id` = `p`.`lote_id`))) where (`p`.`rechazado_en` is not null) union all select 'usuario' AS `usuario`,`us`.`id` AS `id`,`us`.`complete_name` AS `complete_name`,'CREAR' AS `CREAR`,NULL AS `NULL`,NULL AS `NULL`,`us`.`created_by` AS `created_by`,`us`.`created_at` AS `created_at` from `usuarios` `us`) `ev` left join `usuarios` `u` on((`u`.`id` = `ev`.`usuario_id`))) left join `roles` `r` on((`r`.`id` = `u`.`rol_id`))) left join `clientes` `cl` on((`cl`.`id` = `ev`.`cliente_id`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

