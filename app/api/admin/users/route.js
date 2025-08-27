import { prisma, requireAdmin, json } from '@/app/api/admin/_utils';
import bcrypt from 'bcryptjs';

export async function GET(request) {
  const auth = requireAdmin(request.headers);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { first_name: { contains: q, mode: 'insensitive' } },
          { last_name: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, items] = await Promise.all([
    prisma.users.count({ where }),
    prisma.users.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, email: true, first_name: true, last_name: true, is_admin: true, created_at: true },
    }),
  ]);
  return json({ total, page, pageSize, items });
}

export async function POST(request) {
  const auth = requireAdmin(request.headers);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  const { email, password, first_name, last_name, is_admin } = body;
  if (!email || !password) return json({ error: 'email and password required' }, 400);
  const exists = await prisma.users.findUnique({ where: { email } });
  if (exists) return json({ error: 'email already exists' }, 409);
  const password_hash = await bcrypt.hash(password, 10);
  const user = await prisma.users.create({ data: { email, password_hash, first_name, last_name, is_admin: !!is_admin } });
  return json({ id: user.id, email: user.email });
}
