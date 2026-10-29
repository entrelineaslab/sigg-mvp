import 'dotenv/config';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const dbPath=process.env.DB_PATH?path.resolve(process.env.DB_PATH):path.join(here,'../db/entre-lineas.sqlite');
const username=String(process.argv[2]||'').trim();
const stdin=process.stdin,stdout=process.stdout;

function readHidden(prompt){
  return new Promise((resolve,reject)=>{
    if(!stdin.isTTY||typeof stdin.setRawMode!=='function')return reject(new Error('Ejecuta este comando desde una terminal interactiva.'));
    let value='';
    stdout.write(prompt);
    stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
    const cleanup=()=>{stdin.off('data',onData);stdin.setRawMode(false);stdin.pause();stdout.write('\n')};
    const onData=chunk=>{
      for(const character of chunk){
        if(character==='\u0003'){cleanup();reject(new Error('Operación cancelada.'));return}
        if(character==='\r'||character==='\n'){cleanup();resolve(value);return}
        if(character==='\u007f'||character==='\b'){if(value.length){value=value.slice(0,-1);stdout.write('\b \b')}continue}
        if(/^\d$/.test(character)&&value.length<4){value+=character;stdout.write('*')}
      }
    };
    stdin.on('data',onData);
  });
}

let db;
try{
  if(!username)throw new Error('Indica el identificador del usuario. Ejemplo: npm run user:set-pin -- mozo');
  db=new Database(dbPath);
  const user=db.prepare('SELECT id_usuario,identificador_acceso FROM Usuario WHERE identificador_acceso=?').get(username);
  if(!user)throw new Error(`No existe el usuario "${username}" en ${dbPath}.`);
  const pin=await readHidden('Nuevo PIN de 4 dígitos: ');
  const confirmation=await readHidden('Repite el nuevo PIN: ');
  if(!/^\d{4}$/.test(pin))throw new Error('El PIN debe contener exactamente 4 dígitos.');
  if(pin==='1234')throw new Error('No se puede volver a usar el PIN demo 1234.');
  if(pin!==confirmation)throw new Error('Los PIN no coinciden; no se modificó la cuenta.');
  const backup=`${dbPath}.pre-pin-reset-${Date.now()}.bak`;
  await db.backup(backup);
  db.transaction(()=>{
    db.prepare('UPDATE Usuario SET credencial=? WHERE id_usuario=?').run(bcrypt.hashSync(pin,12),user.id_usuario);
    db.prepare('UPDATE Control_Acceso SET intentos_fallidos=0,bloqueado_hasta=NULL WHERE id_usuario=?').run(user.id_usuario);
    db.prepare(`INSERT INTO Registro_Auditoria(id_usuario,accion,tipo_entidad,identificador_entidad,detalle_json) VALUES(?,?,?,?,?)`)
      .run(user.id_usuario,'PIN actualizado mediante utilidad local','Usuario',String(user.id_usuario),JSON.stringify({canal:'CLI',operador:'administrador_local'}));
  })();
  console.log(`PIN actualizado para "${username}". Intentos fallidos y bloqueo reiniciados.`);
  console.log(`Copia previa: ${path.basename(backup)}`);
  console.log('El PIN se almacenó como hash y no se muestra en pantalla.');
}catch(error){
  console.error(`No se cambió el PIN: ${error.message}`);
  process.exitCode=1;
}finally{db?.close()}
