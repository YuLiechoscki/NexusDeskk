import { z } from 'zod';
import { pool } from './db.js';
import { hashPassword } from '../services/password.js';

try {
  const name = z.string().trim().min(2).max(100).parse(process.env.ADMIN_NAME);
  const email = z.email().max(254).parse(process.env.ADMIN_EMAIL).toLowerCase();
  const password = z.string().min(12).max(128).parse(process.env.ADMIN_PASSWORD);
  await pool.query(`INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,'admin')`, [name, email, await hashPassword(password)]);
  console.log('Administrador criado.');
} finally {
  await pool.end();
}
