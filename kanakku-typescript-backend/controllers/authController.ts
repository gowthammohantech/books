import type { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';

import { prisma } from '../lib/prisma';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/generateToken';
import { ensureRole, DEFAULT_ROLE_BY_USER_TYPE, OWNER_ROLE_NAME } from '../lib/defaultRoles';

function badInput(res: Response, errors: ReturnType<typeof validationResult>): void {
  res.status(400).json({
    errors: errors.array().map((err) => err.msg),
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    badInput(res, errors);
    return;
  }

  const { firstName, lastName, email, phone, password } = req.body as {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
  };

  try {
    // Only one admin (user_type === 1) is permitted.
    const existingAdmin = await prisma.user.findFirst({ where: { user_type: 1 } });
    if (existingAdmin) {
      res.status(403).json({
        message: 'Admin account already exists. Only one admin is allowed.',
      });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ message: 'Email already exists' });
      return;
    }

    const hashed = await hashPassword(password);

    // Ensure the Owner role exists (idempotent – safe on fresh installs that
    // haven't been seeded yet) and link it to the new admin user.
    // Resilient: role lookup failure must not block registration — next-boot
    // backfill (seedRoles) will heal the missing roleId automatically.
    let roleId: string | null = null;
    try {
      roleId = await ensureRole(OWNER_ROLE_NAME);
    } catch (roleErr) {
      console.warn('register: ensureRole failed (non-fatal, roleId will be null)', roleErr);
    }

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        password: hashed,
        user_type: 1,
        ...(roleId ? { roleId } : {}),
      },
    });

    res.status(201).json({
      message: 'Admin account created successfully',
      token: generateToken(user.id),
      user,
    });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    badInput(res, errors);
    return;
  }

  const { email, password } = req.body as { email: string; password: string };

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await comparePassword(password, user.password))) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    // Capture login activity (best-effort; failure here must not break login).
    try {
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddress =
        (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]) ||
        req.socket.remoteAddress ||
        'Unknown';

      const ua = new UAParser(req.headers['user-agent']).getResult();
      const browser = ua.browser.name || 'Unknown';
      const device = ua.device.model
        ? `${ua.device.vendor || 'Unknown'} ${ua.device.model}`
        : 'Desktop';

      const geo = geoip.lookup(ipAddress);
      const location = geo
        ? `${geo.city || 'Unknown'}, ${geo.country || 'Unknown'}`
        : 'Unknown';

      await prisma.loginActivity.create({
        data: {
          userId: user.id,
          ipAddress,
          browser,
          device,
          location,
        },
      });
    } catch (activityErr) {
      console.warn('LoginActivity recording failed (non-fatal)', activityErr);
    }

    // Never ship the password hash; expose a ready-to-use profileImageUrl so the
    // header avatar renders the photo right after login (not just after an edit).
    const { password: _pw, ...safeUser } = user;
    res.json({
      message: 'Login successful',
      // Embed the company-owner id so the session shares the workspace dataset.
      // The owner's own ownerId is null, so it falls back to its own id.
      token: generateToken(user.id, user.ownerId ?? user.id),
      user: {
        ...safeUser,
        profileImageUrl: user.profileImage
          ? `${req.protocol}://${req.get('host')}/${user.profileImage}`
          : null,
      },
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export function logout(_req: Request, res: Response): void {
  res.json({ message: 'Logout successful (handled client-side)' });
}

// CommonJS interop for legacy JS callers
module.exports = { register, login, logout };
module.exports.register = register;
module.exports.login = login;
module.exports.logout = logout;
