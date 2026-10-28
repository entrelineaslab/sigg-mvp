# Decisión técnica: SQLite local o base cloud

## Respuesta corta
SQLite puede alojarse en una máquina virtual o servidor cloud y ser accedido por la aplicación Node.js. También existen servicios cloud compatibles con SQLite/libSQL, como Turso. No obstante, SQLite no es un servicio cliente-servidor administrado equivalente a MongoDB Atlas cuando solo se copia el archivo `.sqlite` a almacenamiento compartido.

## Distinción importante
La aplicación debería conectarse a su propio backend Node.js por HTTP/WebSocket; Node.js accede al archivo SQLite en el mismo servidor. Esto funciona tanto en una PC del restaurante como en un servidor cloud con disco persistente. No se deben conectar varias tablets para abrir el mismo archivo SQLite por SMB/NFS. El modo WAL requiere que los procesos compartan memoria en el mismo equipo, no funciona sobre un sistema de archivos de red y conserva un solo escritor a la vez [1]. SQLite recomienda un motor cliente-servidor cuando numerosos clientes acceden a un repositorio central a través de una red [2].

MongoDB Atlas es un servicio administrado que ejecuta MongoDB en AWS, Azure o Google Cloud y gestiona tareas como provisión, parches, respaldo, monitoreo y escalado [3]. Tiene una arquitectura de acceso remoto a través de red, lo que implica que un sistema del restaurante que dependa exclusivamente de Atlas necesita conectividad con Internet.

Hay servicios cloud compatibles con SQLite, pero son distintos del archivo SQLite local. Turso ofrece una plataforma administrada con motores compatibles con SQLite; la documentación indica que el producto Turso Cloud está en etapa de preview temprano [4]. Esto requiere evaluar su madurez, disponibilidad, región, respaldo y coste antes de adoptarlo.

## Recomendación para Entre Líneas
Por el requisito RNF-03 —seguir operando ante una caída de Internet— la base operativa debe continuar local, junto al servidor Node.js del restaurante. Se puede añadir una copia de seguridad o sincronización a cloud cuando la conexión vuelva. Una base exclusivamente cloud (Atlas o SQLite administrado cloud) no satisface por sí sola esa autonomía. Si se decide migrar a MongoDB local o Atlas como principal, habrá que rediseñar el modelo y cambiar el requisito de offline o añadir replicación local.

### Fuentes
[1] [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html) — restricciones WAL, sistema de archivos de red y concurrencia.
[2] [Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html) — cuándo elegir SQLite frente a un motor cliente-servidor.
[3] [MongoDB Atlas documentation](https://www.mongodb.com/docs/atlas/) — servicio administrado y proveedores cloud.
[4] [Turso Cloud documentation](https://docs.turso.tech/turso-cloud) — motores compatibles y estado preview.
