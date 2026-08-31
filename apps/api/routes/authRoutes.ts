import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import {
  register,
  login,
  logout,
  switchTenant,
  session,
  createTenant,
} from '../controllers/authController';
import { registerValidator, loginValidator } from '../validators/authValidator';
import protect from '../middleware/authMiddleware';

const router = Router();

/**
 * Signup is now PUBLIC and UNCAPPED — the "only one admin" guard that made this
 * install single-tenant is gone. Two limiters replace it, shaped after the one
 * routes/publicRoutes.ts already uses for token enumeration.
 *
 * Two windows rather than one: the hourly limit stops a burst, the daily limit
 * stops a slow drip that would sit under it all day. Every rejected request is
 * cheap — the limiter runs before any DB work.
 */
const signupHourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-up attempts. Please try again later.' },
});

const signupDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-up attempts. Please try again later.' },
});

/** Switching workspaces mints a token, so it gets a limiter too — a light one. */
const switchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests' },
});

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create a user and their first workspace
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, email, password]
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               companyName: { type: string, description: Workspace name }
 *     responses:
 *       201:
 *         description: Workspace created; returns a token, the tenant and the caller's memberships
 *       403:
 *         description: Sign-ups disabled or workspace cap reached
 */
router.post('/register', signupHourlyLimiter, signupDailyLimiter, registerValidator, register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Authenticate user
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Returns a JWT plus the active workspace and every membership
 *       403:
 *         description: Valid credentials, but no active workspace
 */
router.post('/login', loginValidator, login);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out current session
 *     responses:
 *       200:
 *         description: Logged out
 */
router.post('/logout', logout);

/**
 * @swagger
 * /auth/session:
 *   get:
 *     tags: [Auth]
 *     summary: Everything the SPA needs for the current user in the current workspace
 *     responses:
 *       200:
 *         description: user, tenant, memberships, setup status and permissions
 */
router.get('/session', protect, session);

/**
 * @swagger
 * /auth/switch-tenant:
 *   post:
 *     tags: [Auth]
 *     summary: Mint a token for another of the caller's workspaces
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId]
 *             properties:
 *               tenantId: { type: string }
 *     responses:
 *       200:
 *         description: New token for the target workspace
 *       403:
 *         description: Caller is not a member of that workspace
 */
router.post('/switch-tenant', protect, switchLimiter, switchTenant);

/**
 * @swagger
 * /auth/tenants:
 *   post:
 *     tags: [Auth]
 *     summary: Create an additional workspace owned by the signed-in user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [companyName]
 *             properties:
 *               companyName: { type: string }
 *     responses:
 *       201:
 *         description: Workspace created; returns a token for it
 */
router.post('/tenants', protect, signupHourlyLimiter, createTenant);

export default router;

// CommonJS interop so server.js's require() picks up the Express router
module.exports = router;
