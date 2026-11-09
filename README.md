# SIGG — Sistema Integral de Gestión Gastronómica
### Entre Líneas Lab — Gastro POS Local (Etapa 3: MVP Funcional)

> **Instituto de Formación Técnica Superior N° 29**  
> **Carrera:** Tecnicatura Superior en Desarrollo de Software  
> **Cátedra:** Práctica Profesionalizante IV (2026)  
> **Docentes:** Prof. Lic. Emir Eliezer García Ontiveros | Prof. Lic. Kevin Del Bello  
> **Equipo de Desarrollo:** Guillermina Zen Cáffaro, Walter David Ciancio, Sergio de los Santos, Mario Julio Alegre.  
> **Cliente Didáctico:** Restaurante Didáctico IFTS N° 34  

Plataforma cliente-servidor distribuida en red local (LAN/WLAN) diseñada para digitalizar integralmente el circuito transaccional del restaurante: Salón y Mesas, Comandeo táctil en 4 partidas, Cocina (KDS pasivo manos libres), Reservas con lista de espera FIFO y Estación de Caja con auditoría transaccional. Alineado al diseño de pantallas en Figma, al DER oficial en español y a los requerimientos de la Etapa 3.

---

## Recursos, Diseño y Documentación del Proyecto

- **Prototipo Interactivo (Figma):** [Ver prototipo navegable oficial](https://www.figma.com/proto/phlhkr4tOWqRIyoVCAnffW/Entre-L%C3%ADneas-Lab?node-id=6-46&viewport=433%2C2106%2C0.68&t=6yA6hJUiQvXXtswc-1&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=1%3A162&page-id=0%3A1)
- **Documentación y Entregables (Google Drive):** [Carpeta general del proyecto](https://drive.google.com/drive/folders/1HlfdtsXKSsmF5yaqBUO7ZzY-qhdZzXNy?usp=drive_link)
- **Diagramas de Arquitectura y DER:** [Carpeta de diagramas del sistema](https://drive.google.com/drive/folders/1JBIJRaWXneaofTXialPZsvUxBRmQZk6G?usp=drive_link)
- **Registro de Requerimientos y Backlog (Fase 2):** [Documento de alcance futuro y backlog](https://docs.google.com/document/d/1Bjt1Cgpag7BwMwsdiufky28izSmH-ERmfzJvqN31l2U/edit?usp=sharing)
- **Presentación Ejecutiva:** [Diapositivas del proyecto en Canva](https://canva.link/ptjr4c5r56bw6ks)
- **Guías de Puesta en Marcha:**
  * [Guía paso a paso para evaluación](docs/GUIA-PASO-A-PASO.md)
  * [Informe de resultados de pruebas](docs/PRUEBAS-ETAPA3.md)

---

## Inicio rápido

Clona el repositorio y entra a la carpeta:

```bash
git clone [https://github.com/entrelineaslab/sigg-mvp.git](https://github.com/entrelineaslab/sigg-mvp.git)
cd sigg-mvp
```

La [guía paso a paso](docs/GUIA-PASO-A-PASO.md) es la entrada recomendada para instalar y ejecutar el proyecto. Consulta también los [resultados de pruebas de Etapa 3](docs/PRUEBAS-ETAPA3.md).

## Arquitectura y datos

Node.js ejecuta Express y Socket.IO. SQLite es la base local, accedida desde Node mediante `better-sqlite3` con WAL. El archivo operativo de desarrollo está en `server/db/entre-lineas.sqlite`; el DDL está en `server/db/schema.sql`. Las nueve entidades y sus nombres de columna del DER se mantienen en español: `Mesa`, `Rol`, `Usuario`, `Seccion_Producto`, `Producto`, `Comanda`, `Detalle_Comanda`, `Reserva` y `Transaccion_Cobro`. La extensión `Detalle_Comanda.fecha_hora_envio` registra cuándo se envía cada ítem a cocina. El estado de elaboración se limita a `En_Preparacion`, `Entregado` y `Cancelado`. La lista de espera se almacena en `Reserva` con `estado='En_Lista_Espera'`.

La API usa algunos alias para la interfaz React, pero no son nombres de columnas ni tablas de SQLite. Tablas auxiliares técnicas: `Control_Acceso`, `Datos_Operacion_Comanda`, `Llave_Idempotencia` y `Registro_Auditoria`.

## Requisitos e instalación

Requiere Node.js 20+ y npm. Desde la raíz del proyecto, instala dependencias y copia los archivos de entorno **antes** de inicializar la base:

```bash
npm install --prefix server
npm install --prefix client
```

En Windows **cmd** usa `copy server\.env.example server\.env` y `copy client\.env.example client\.env`. En PowerShell usa `Copy-Item server/.env.example server/.env` y `Copy-Item client/.env.example client/.env`. El comando `cp` que aparece en algunas instrucciones solo corresponde a Git Bash, Linux o macOS. Si los archivos `.env` ya existen, no los sobrescribas: consérvalos y edítalos según sea necesario.

Luego, inicializa la base de desarrollo:

```bash
npm run db:init --prefix server
```

Antes de un piloto, reemplazar el `JWT_SECRET` de `server/.env` por uno aleatorio y cambiar el PIN demo.

Para iniciar el entorno local, abrir dos terminales desde la raíz:

```bash
npm run dev --prefix server
```

```bash
npm run dev --prefix client
```

Abrir `http://localhost:5173`. La API y Socket.IO escuchan en el puerto `3001`; Vite ya enlaza el puerto `5173` a `0.0.0.0`. Para tablets, definir `VITE_API_URL=http://IP_DEL_SERVIDOR:3001` en `client/.env` y `CLIENT_ORIGIN=http://IP_DEL_SERVIDOR:5173` en `server/.env`. Si se usa un hostname en lugar de una IP, configurar `VITE_ALLOWED_HOST` con ese hostname. No se necesita Internet entre cliente y servidor de la LAN; la red local, el equipo servidor y la alimentación eléctrica sí deben estar disponibles. Esta configuración de desarrollo usa HTTP, no es una instalación endurecida para producción.

## Base existente, backup y migración

La ruta predeterminada de SQLite es `server/db/entre-lineas.sqlite` (salvo que `DB_PATH` en `server/.env` indique otra ruta). La aplicación usa WAL; al reiniciar desde cero elimina **todos los datos** de la base objetivo. Para volver al estado de fábrica en desarrollo:

1. Detén el servidor con `Ctrl+C` en su terminal y confirma que no quede ningún proceso de la aplicación usando la base.
2. Antes de borrar nada, crea una copia de seguridad. Por ejemplo, en PowerShell:

   ```powershell
   Copy-Item server/db/entre-lineas.sqlite server/db/entre-lineas.sqlite.manual.bak
   ```

   En Windows cmd: `copy server\db\entre-lineas.sqlite server\db\entre-lineas.sqlite.manual.bak`. En Git Bash/Linux/macOS: `cp server/db/entre-lineas.sqlite server/db/entre-lineas.sqlite.manual.bak`. Si `DB_PATH` apunta a otra ubicación, respalda ese archivo en vez de la ruta predeterminada. Verifica que el respaldo exista antes de continuar.
3. Con la aplicación detenida y el respaldo verificado, elimina el archivo principal y, si existen, los auxiliares WAL/SHM (`entre-lineas.sqlite-wal` y `entre-lineas.sqlite-shm`) de la **misma** ubicación. En PowerShell, por ejemplo:

   ```powershell
   Remove-Item server/db/entre-lineas.sqlite, server/db/entre-lineas.sqlite-wal, server/db/entre-lineas.sqlite-shm -ErrorAction SilentlyContinue
   ```

   En cmd elimina únicamente esas rutas explícitas con `del /q server\db\entre-lineas.sqlite server\db\entre-lineas.sqlite-wal server\db\entre-lineas.sqlite-shm`; no uses comodines, porque podrían borrar también el respaldo. Git Bash/Linux/macOS puede usar `rm -f server/db/entre-lineas.sqlite server/db/entre-lineas.sqlite-wal server/db/entre-lineas.sqlite-shm`. No borres el respaldo.
4. Inicializa de nuevo desde la raíz con `npm run db:init --prefix server`.

**Advertencia:** borrar la base elimina comandas, reservas, cobros, usuarios y cualquier otro dato guardado. No uses este procedimiento en una base operativa; conserva y prueba el respaldo antes de proceder.

`npm run db:init --prefix server` ejecuta el DDL y crea las cuentas/catálogos demo faltantes. El campo `fecha_hora_envio` se agrega con `ALTER TABLE`; los detalles anteriores se completan con la fecha de la comanda. La migración incremental crea un archivo `.pre-etapa3-<timestamp>.bak` antes de modificar la base. Al encontrar el esquema legado en inglés, el inicializador crea una copia `.pre-der-espanol-<timestamp>.bak`; si detecta comandas, detalles, reservas, espera o cobros en ese esquema, se detiene para que se revise la conversión.

El inicializador no elimina transacciones. Los usuarios y precios de productos ya existentes se preservan al volver a ejecutar el DDL; los datos descriptivos de productos semilla se sincronizan sin reemplazar el precio configurado. Aun así, antes de usar una base del restaurante, hacer una copia manual, probar restauración y revisar las migraciones con el equipo responsable. Las pruebas no usan este archivo: inicializan su propia base SQLite temporal.

## Usuarios de demostración

Perfiles: `mozo`, `jefe`, `cocina`, `caja` y `admin`; PIN inicial de demo `1234`. El inicializador solo crea esas credenciales cuando faltan. Los PIN demo no deben usarse en producción.

- **Mozo:** Salón, comanda de mesa ocupada y Despacho; no administra reservas ni confirma llegadas.
- **Jefe de Salón:** Salón, comanda, Reservas/Espera y Despacho; no entra al KDS general. La intervención sobre un plato se habilita en servidor solo después de superar 25 minutos desde `fecha_hora_envio`.
- **Cocina:** KDS de solo lectura.
- **Caja:** revisión de cuentas, anulación auditada de ítems todavía no elaborados y cobro.
- **Administrador:** visible como “En desarrollo”; sin módulos, endpoints operativos ni sala de eventos.

### Preparación de credenciales antes de un piloto controlado

En `server/.env`, reemplaza `JWT_SECRET` por una cadena aleatoria larga. Puedes generar una con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`; copia el resultado **solo** a ese archivo, no al chat ni al repositorio. Reinicia la API después de cambiarlo; al rotarlo, los tokens de sesión existentes dejan de servir.

Para cambiar el PIN de un perfil, desde la raíz ejecuta, por ejemplo, `npm run user:set-pin --prefix server -- mozo`. La terminal pedirá dos veces un PIN nuevo de 4 dígitos sin mostrarlo, guardará solo su hash, limpiará bloqueos y creará una copia de seguridad de la base. Repite el comando usando `jefe`, `cocina`, `caja` o `admin`. No introduzcas PIN por SQL ni modifiques manualmente `Usuario.credencial`.

**Límite importante:** esta versión tiene una cuenta compartida por rol (por ejemplo, `mozo`), no cuentas personales para cada empleado; cambiar el PIN del rol no da atribución individual. Es adecuada para un piloto técnico controlado en LAN, no es todavía una solución endurecida para el registro individual de personal.

## Flujos disponibles

- **Salón y comanda:** al tocar una mesa libre, el Mozo confirma la cantidad de comensales (1–4, según la capacidad). La mesa queda ocupada sin Comanda hasta que se envía el primer plato. Si el grupo se retira sin pedir, puede usarse “Liberar mesa”; la acción se bloquea cuando quedan platos activos. En una mesa con cuenta activa, “Ver Comanda” abre la misma cuenta. Cada ítem guarda precio histórico, observaciones completas y hora individual de envío; la clave idempotente protege los reintentos.
- **Preparación y entrega:** los ítems nacen en `En_Preparacion` y el ciclo es `En_Preparacion → Entregado`. Mozo confirma la entrega; Jefe puede hacerlo como intervención jerárquica solo después de superar 25 minutos, con auditoría. Caja no cierra mientras haya ítems en preparación, aunque permite anularlos explícitamente y recalcula. `queued` pertenece únicamente a la cola offline del navegador, no al estado de elaboración.
- **Desconexión:** los pedidos enviados durante un microcorte quedan en almacenamiento local del navegador y se reintentan con la misma clave al reconectar y durante el ciclo de recuperación. Si el servidor rechaza permanentemente uno, queda retenido con el error visible y el usuario puede reintentar o descartarlo con confirmación. En el KDS se advierte cuando la vista puede estar desactualizada y se resincroniza al volver la conexión.
- **Reservas y lista de espera:** se filtran por fecha y turno; la ausencia genera alerta a 10 minutos y cancelación a 15. Anular una reserva libera su mesa cuando corresponde y genera auditoría. El backend asigna al primer grupo elegible por orden de registro y capacidad; asignar mesa crea `Confirmada/Reservada`, no Comanda. Si al llegar la mesa asignada todavía está ocupada, **Llegó / Sentar** reasigna el grupo a una mesa libre compatible, informa cuál es y crea allí la Comanda; si no existe alternativa, deja la reserva pendiente y muestra cómo resolverlo.
- **KDS:** solo lectura, ordena por fecha/hora individual más antigua, marca el umbral de 25 minutos, muestra observaciones íntegras y rota páginas cada 10 segundos.
- **Caja:** el detalle muestra el nombre principal de cada plato y su descripción secundaria, junto con cantidades, precios históricos y subtotales. No preselecciona medio de pago. Soporta `Efectivo`, `Tarjeta_Debito`, `Tarjeta_Credito` y `Transferencia_QR`. La acción “Simular rechazo” es exclusivamente de prueba: no registra cobro, no cierra comanda ni libera mesa. No hay integración real con adquirentes ni bancos.
- **Tiempo real:** eventos críticos requieren reconocimiento de clientes Socket.IO; el servidor registra una advertencia si su RTT supera 3 segundos. Esto instrumenta el criterio, pero no equivale a una medición ni certificación de latencia en la red del restaurante.

## Pruebas

Desde la raíz:

```bash
npm test --prefix server
npm run build --prefix client
```

Las pruebas unitarias revisan capacidad, total monetario histórico, límite de permanencia y estados secuenciales. Una prueba de migración reconstruye `Detalle_Comanda`, convierte registros antiguos `Pendiente` a `En_Preparacion`, conserva los datos y verifica el nuevo `CHECK`. Las pruebas de integración crean bases temporales desechables y cubren permisos, idempotencia, estados por rol, reservas, Caja y eventos Socket.IO; no alteran el archivo de demostración.

## Regla temporal pendiente de aprobación

Hallazgos H33/H34 señalan que la ventana de conflicto entre reservas (±120 minutos) y el pre-bloqueo de mesas (+180 minutos) requieren confirmación del equipo; se conservan aisladas y no se reemplazan por una hipótesis de 40 minutos. La reserva futura no se rechaza solo por una comanda actualmente abierta, porque el sistema todavía no tiene una duración de servicio aprobada.
El filtro de turno predeterminado infiere `Noche` desde las 18:00 y `Mediodía` antes de esa hora, ya que el documento aún no define los horarios oficiales de los turnos. Se puede cambiar manualmente en pantalla y el límite horario debe validarse con el equipo.

## Antes de un piloto real

En una copia separada, cambiar PIN y `JWT_SECRET`, ajustar usuarios/catálogo y definir backups/recuperación. Medir la lectura del KDS a 1,5 m, la propagación con carga y los microcortes reales desde las tablets; revisar las ventanas de reserva con el equipo. Las pruebas de Sandbox no sustituyen esas comprobaciones locales.
