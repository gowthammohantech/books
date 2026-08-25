import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

import { requireUserId, requireActingUserId, UnauthorizedError } from '../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function dashboard(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const userData = await prisma.user.findUnique({ where: { id: userId } });
    res.json({
      message: 'Admin dashboard',
      user: userData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      message: 'Error fetching dashboard',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCountries(req: Request, res: Response): Promise<void> {
  try {
    const search = (req.query.search as string) ?? '';
    const where: Prisma.CountryWhereInput = {};
    const select = { id: true, name: true };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    // Country counts are small (≤ ~250 even with a full dataset); return all.
    const countries = await prisma.country.findMany({ where, select, take: 1000 });
    res.json(countries);
  } catch (err) {
    res.status(500).json({
      message: 'Error fetching countries',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getStates(req: Request, res: Response): Promise<void> {
  const { countryId } = req.params as { countryId: string };
  try {
    const search = (req.query.search as string) ?? '';
    const where: Prisma.StateWhereInput = { country_id: countryId };
    const select = { id: true, name: true };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    // States are scoped by countryId; even globally ≤ a few thousand. Return all per country.
    const states = await prisma.state.findMany({ where, select, take: 1000 });
    res.json(states);
  } catch (err) {
    res.status(500).json({
      message: 'Error fetching states',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCities(req: Request, res: Response): Promise<void> {
  const { stateId } = req.params as { stateId: string };
  try {
    const search = (req.query.search as string) ?? '';
    const where: Prisma.CityWhereInput = { state_id: stateId };
    const select = { id: true, name: true };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    // Cities stay capped (take: 1000) for scale — a full dataset can have tens of thousands.
    // Use ?search= typeahead for large datasets; this cap covers all reasonable seed data.
    const cities = await prisma.city.findMany({ where, select, take: 1000 });
    res.json(cities);
  } catch (err) {
    res.status(500).json({
      message: 'Error fetching cities',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// getProfile
export async function getProfile(req: Request, res: Response): Promise<void> {
  try {
    // Self-account op: the acting user's OWN id, not the tenant/owner id —
    // staff must read their own profile, not the company owner's.
    const userId = requireActingUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        country: { select: { id: true, name: true } },
        state: { select: { id: true, name: true } },
        city: { select: { id: true, name: true } },
      },
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Exclude password from the final result
    const { password: _password, ...userWithoutPassword } = user;
    void _password;

    res.json({
      ...userWithoutPassword,
      profileImageUrl: user.profileImage
        ? `${req.protocol}://${req.get('host')}/${user.profileImage}`
        : null,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      message: 'Error fetching user profile',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  try {
    // Self-account op: update the acting user's OWN record, not the owner's.
    const userId = requireActingUserId(req);

    const body = req.body as Record<string, unknown>;
    const updateData: Prisma.UserUpdateInput = {};

    if (body.firstName !== undefined) updateData.firstName = body.firstName as string;
    if (body.lastName !== undefined) updateData.lastName = body.lastName as string;
    if (body.email !== undefined) updateData.email = body.email as string;
    if (body.gender !== undefined) {
      // Multipart sends an empty string when no gender is selected; coerce
      // empty/invalid to null (the column is nullable) so Prisma's UserGender
      // enum validation doesn't 500.
      const g = body.gender as string;
      updateData.gender = g === 'male' || g === 'female' || g === 'other' ? g : null;
    }
    if (body.address !== undefined) updateData.address = body.address as string;
    if (body.dateOfBirth !== undefined && body.dateOfBirth) {
      updateData.dateOfBirth = new Date(body.dateOfBirth as string);
    }
    if (body.phone !== undefined) updateData.phone = body.phone as string;
    if (body.postalCode !== undefined) updateData.postalCode = body.postalCode as string;

    if (body.country !== undefined) {
      updateData.country = body.country
        ? { connect: { id: body.country as string } }
        : { disconnect: true };
    }
    if (body.state !== undefined) {
      updateData.state = body.state
        ? { connect: { id: body.state as string } }
        : { disconnect: true };
    }
    if (body.city !== undefined) {
      updateData.city = body.city
        ? { connect: { id: body.city as string } }
        : { disconnect: true };
    }

    if (req.file) {
      updateData.profileImage = `uploads/${req.file.filename}`;
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      res.json({
        message: 'User profile updated successfully',
        user: {
          ...updatedUser,
          profileImageUrl: updatedUser.profileImage
            ? `${req.protocol}://${req.get('host')}/${updatedUser.profileImage}`
            : null,
        },
      });
    } catch (prismaErr) {
      // Unique constraint (P2002) → email already in use
      if (
        prismaErr &&
        typeof prismaErr === 'object' &&
        'code' in prismaErr &&
        (prismaErr as { code: string }).code === 'P2002'
      ) {
        res.status(409).json({
          message: 'Email address is already in use.',
          error: prismaErr instanceof Error ? prismaErr.message : String(prismaErr),
        });
        return;
      }
      // P2025 → record not found
      if (
        prismaErr &&
        typeof prismaErr === 'object' &&
        'code' in prismaErr &&
        (prismaErr as { code: string }).code === 'P2025'
      ) {
        res.status(404).json({ message: 'User not found' });
        return;
      }
      throw prismaErr;
    }
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error(err);
    res.status(500).json({
      message: 'Error updating user profile',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCountryById(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  try {
    const country = await prisma.country.findUnique({ where: { id } });
    if (!country) {
      res.status(404).json({ message: 'Country not found' });
      return;
    }
    res.json(country);
  } catch (err) {
    res.status(500).json({
      message: 'Error fetching country',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getStateById(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  try {
    const state = await prisma.state.findUnique({ where: { id } });
    if (!state) {
      res.status(404).json({ message: 'State not found' });
      return;
    }
    res.json(state);
  } catch (err) {
    res.status(500).json({
      message: 'Error fetching state',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCityById(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  try {
    const city = await prisma.city.findUnique({ where: { id } });
    if (!city) {
      res.status(404).json({ message: 'City not found' });
      return;
    }
    res.json(city);
  } catch (err) {
    res.status(500).json({
      message: 'Error fetching city',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  dashboard,
  getCountries,
  getStates,
  getCities,
  getProfile,
  updateProfile,
  getCountryById,
  getStateById,
  getCityById,
};
module.exports.dashboard = dashboard;
module.exports.getCountries = getCountries;
module.exports.getStates = getStates;
module.exports.getCities = getCities;
module.exports.getProfile = getProfile;
module.exports.updateProfile = updateProfile;
module.exports.getCountryById = getCountryById;
module.exports.getStateById = getStateById;
module.exports.getCityById = getCityById;
