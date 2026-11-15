import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newDb} from 'pg-mem';
import session from 'express-session';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import {createAuth} from '../src/auth/index.js';
import {createApp} from '../src/app.js';
import {createFixture} from '../../tests/fixtures.js';
import {hashPassword} from '../../shared/server/auth/crypto.js';
const password='block9-test-password-123';
async function setup(){
 const {Pool}=newDb().adapters.createPg(),pool=new Pool();
 await pool.query(await readFile(new URL('../migrations/001-auth.sql',import.meta.url),'utf8'));
 const users={};for(const role of ['viewer','editor','admin'])users[role]=(await pool.query("INSERT INTO block8_auth.users(email,password_hash,role,status,email_verified_at,chef_id) VALUES($1,$2,$3,'active',now(),$4) RETURNING *",[`${role}@example.test`,await hashPassword(password),role,role==='editor'?1:null])).rows[0];
 const auth=createAuth({pool,sessionStore:new session.MemoryStore(),mfaEncryptionKey:Buffer.alloc(32,7).toString('base64'),recaptchaVerifier:async()=>true,mailer:{sendMail:async()=>({accepted:['test']})}});
 const fixture=createFixture();fixture.storage.dish[0].chefId=1;fixture.storage.dish[0].status='draft';fixture.storage.dish[1].chefId=1;fixture.storage.dish[1].status='published';
 const app=createApp({db:fixture.db,auth});
 return {pool,auth,app,users,fixture};
}
const csrf=res=>res.text.match(/name="_csrf" value="([^"]+)"/)[1];
async function login(app,role){const agent=request.agent(app);const page=await agent.get('/login');await agent.post('/login').type('form').send({_csrf:csrf(page),email:`${role}@example.test`,password}).expect(303);return agent;}
test('SSR enforces Viewer/Editor/Admin on forms, direct writes and changed permissions',async()=>{
 const {app,pool,auth,fixture}=await setup();
 try{
  await request(app).get('/admin').expect(303).expect('Location','/login');
  const viewer=await login(app,'viewer');await viewer.get('/admin/dishes').expect(200);
  await viewer.get('/admin/dishes/new').expect(403);await viewer.get('/admin/dishes/1/edit').expect(403);
  const viewerPage=await viewer.get('/login');await viewer.post('/admin/dishes').type('form').send({_csrf:csrf(viewerPage),name:'bad',price:'10'}).expect(403);
  const editor=await login(app,'editor');const form=await editor.get('/admin/dishes/1/edit').expect(200);
  await editor.get('/admin/dishes/2/edit').expect(403);await editor.get('/admin/dishes/1/delete').expect(403);
  await editor.patch('/admin/dishes/1').type('form').send({_csrf:csrf(form),name:'Editor edit',price:'1000',chefId:'2',status:'published',available:'true'}).expect(303);
  assert.equal(fixture.storage.dish[0].chefId,1);assert.equal(fixture.storage.dish[0].status,'draft');
  fixture.storage.dish[0].status='published';
  await editor.patch('/admin/dishes/1').type('form').send({_csrf:csrf(form),name:'Denied',price:'10'}).expect(403);
  assert.equal(fixture.storage.dish[0].name,'Editor edit');
  const admin=await login(app,'admin');await admin.get('/admin/dishes/2/edit').expect(200);
  await pool.query("UPDATE block8_auth.users SET role='viewer' WHERE email='admin@example.test'");
  const adminPage=await admin.get('/login');await admin.delete('/admin/dishes/2').type('form').send({_csrf:csrf(adminPage)}).expect(403);
 }finally{await auth.drainMail();await pool.end();}
});
test('SSR mfaPending cannot access admin; recovery rotates sid; reset/version changes do not disable MFA',async()=>{
 const {app,pool,auth,users}=await setup();
 try{
  const setup=await auth.mfa.setup(users.admin.id,{password});
  const enabled=await auth.mfa.confirm(users.admin.id,{otp:new OTPAuth.TOTP({secret:setup.secret}).generate()});
  const agent=request.agent(app),page=await agent.get('/login');
  const pending=await agent.post('/login').type('form').send({_csrf:csrf(page),email:users.admin.email,password}).expect(303).expect('Location','/mfa');
  await agent.get('/admin').expect(303).expect('Location','/mfa');
  const mfaPage=await agent.get('/mfa').expect(200);
  const complete=await agent.post('/mfa').type('form').send({_csrf:csrf(mfaPage),recoveryCode:enabled.recoveryCodes[0]}).expect(303);
  assert.notEqual(pending.headers['set-cookie'][0].split(';')[0],complete.headers['set-cookie'][0].split(';')[0]);
  await agent.get('/admin/dishes').expect(200);
  const security=await agent.get('/account/security').expect(200);assert.doesNotMatch(security.text,new RegExp(setup.secret));
  await pool.query('UPDATE block8_auth.users SET version=version+1 WHERE id=$1',[users.admin.id]);
  await agent.get('/admin').expect(303).expect('Location','/login');
  const again=await agent.get('/login');await agent.post('/login').type('form').send({_csrf:csrf(again),email:users.admin.email,password}).expect(303).expect('Location','/mfa');
  assert.equal((await pool.query('SELECT mfa_enabled FROM block8_auth.users WHERE id=$1',[users.admin.id])).rows[0].mfa_enabled,true);
 }finally{await auth.drainMail();await pool.end();}
});
