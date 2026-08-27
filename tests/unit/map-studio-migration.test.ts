import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const databases: DatabaseSync[] = [];
function before0043(): string[] { return readdirSync('migrations').filter((name) => /^\d{4}_.*\.sql$/u.test(name) && Number(name.slice(0,4)) <= 42).sort(); }
function rows<T extends object>(db:DatabaseSync,sql:string):T[]{return db.prepare(sql).all() as T[];}
afterEach(()=>{for(const db of databases.splice(0))db.close();});

describe('migration 0043 - Map Studio User-First',()=>{
  it('cria mapas user-owned e remove somente o link quando um World é excluído',()=>{
    const db=new DatabaseSync(':memory:');databases.push(db);db.exec('PRAGMA foreign_keys=ON;');
    for(const file of before0043())db.exec(readFileSync(`migrations/${file}`,'utf8'));
    db.exec(readFileSync('migrations/0043_map_studio_user_first.sql','utf8'));
    const now='2026-08-26T12:00:00.000Z';
    db.prepare('INSERT INTO users (id,email,email_normalized,display_name,password_hash,created_at,updated_at,password_changed_at) VALUES (?,?,?,?,?,?,?,?)').run('u1','u1@example.com','u1@example.com','U1','hash',now,now,now);
    db.prepare('INSERT INTO worlds (id,owner_user_id,name,slug,description,visibility,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('w1','u1','World','world','', 'PRIVATE','ACTIVE',now,now);
    db.prepare('INSERT INTO map_documents (id,owner_user_id,name,description,map_type,width,height,grid_type,grid_size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('m1','u1','Mapa','', 'GENERIC',1920,1080,'NONE',50,now,now);
    db.prepare('INSERT INTO map_document_world_links (map_document_id,world_id,created_at) VALUES (?,?,?)').run('m1','w1',now);
    db.prepare('DELETE FROM worlds WHERE id=?').run('w1');
    expect(rows(db,'SELECT id,owner_user_id,document_json,document_version FROM map_documents')).toEqual([{
      id:'m1',owner_user_id:'u1',
      document_json:'{"version":1,"backgroundColor":"#f5f1e8","layers":[]}',
      document_version:0,
    }]);
    expect(rows(db,'SELECT * FROM map_document_world_links')).toEqual([]);
    expect(rows(db,'PRAGMA foreign_key_check')).toEqual([]);
  });
});
