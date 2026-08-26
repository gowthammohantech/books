import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function createRole(req: Request, res: Response): Promise<void> {
  try {
    const { roleName, status = true, defaultRoute } = req.body as {
      roleName?: string;
      status?: boolean;
      defaultRoute?: string;
    };
    const userId = requireUserId(req);

    // Collect validation errors
    const errors: Record<string, string> = {};

    // Validate roleName
    if (!roleName || !roleName.trim()) {
      errors.roleName = 'Role name is required';
    }

    // Validate defaultRoute (optional — only reject if provided but blank)
    if (defaultRoute !== undefined && !defaultRoute.trim()) {
      errors.defaultRoute = 'Default route cannot be empty';
    }

    // Validate user existence
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(422).json({
        message: 'Validation failed',
        errors: { user: 'User not found' },
      });
      return;
    }

    if (!errors.roleName && roleName) {
      const existingRole = await prisma.role.findFirst({
        where: {
          roleName: roleName.trim(),
          deletedAt: null,
        },
      });
      if (existingRole) {
        errors.roleName = 'Role name already exists';
      }
    }

    // If any validation errors exist, return 422
    if (Object.keys(errors).length > 0) {
      res.status(422).json({
        message: 'Validation failed',
        errors,
      });
      return;
    }

    // Create new role
    const role = await prisma.role.create({
      data: {
        roleName: (roleName as string).trim(),
        status: Boolean(status),
        createdBy: userId,
        ...(defaultRoute !== undefined ? { defaultRoute: defaultRoute.trim() } : {}),
      },
    });

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: {
        id: role.id,
        roleName: role.roleName,
        status: role.status,
        defaultRoute: (role as unknown as { defaultRoute?: string | null }).defaultRoute,
        createdBy: role.createdBy,
        createdAt: role.createdAt,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Role creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating role',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getRoles(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();
    const status = req.query.status as string | undefined;

    const where: Prisma.RoleWhereInput = { deletedAt: null };

    if (search) {
      where.roleName = { contains: search, mode: 'insensitive' };
    }

    if (status !== undefined) {
      where.status = status === 'true';
    }

    const total = await prisma.role.count({ where });

    const roles = await prisma.role.findMany({
      where,
      orderBy: { roleName: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const formattedRoles = roles.map((role) => ({
      id: role.id,
      roleName: role.roleName,
      status: role.status,
      createdBy: role.createdBy || null,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: 'Roles fetched successfully',
      data: {
        roles: formattedRoles,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('Error fetching roles:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching roles',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function listUsersByRole(req: Request, res: Response): Promise<void> {
  try {
    const { roleId } = req.params as { roleId: string };
    const search = ((req.query.search as string) ?? '').trim();

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      res.status(404).json({
        success: false,
        message: 'Role not found',
      });
      return;
    }

    const where: Prisma.UserWhereInput = { roleId };

    if (search !== '') {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: search !== '' ? 10 : undefined,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        profileImage: true,
        balance: true,
        balance_type: true,
        createdAt: true,
        roleId: true,
        role: { select: { roleName: true } },
      },
    });

    res.status(200).json({
      success: true,
      count: users.length,
      role: {
        id: role.id,
        name: role.roleName,
      },
      data: users,
    });
  } catch (err) {
    console.error('Error listing users by role:', err);
    res.status(500).json({
      success: false,
      message: 'Error listing users by role',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getAllRoles(req: Request, res: Response): Promise<void> {
  try {
    const search = ((req.query.search as string) ?? '').trim();
    const status = req.query.status as string | undefined;

    const where: Prisma.RoleWhereInput = { deletedAt: null };

    if (search) {
      where.roleName = { contains: search, mode: 'insensitive' };
    }

    if (status !== undefined) {
      where.status = status === 'true';
    }

    const roles = await prisma.role.findMany({
      where,
      orderBy: { roleName: 'asc' },
    });

    const formattedRoles = roles.map((role) => ({
      id: role.id,
      roleName: role.roleName,
      status: role.status,
      createdBy: role.createdBy || null,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: 'All roles fetched successfully',
      data: formattedRoles,
    });
  } catch (err) {
    console.error('Error fetching roles:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching roles',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { roleName, status, defaultRoute } = req.body as {
      roleName?: string;
      status?: boolean;
      defaultRoute?: string;
    };

    // Find role by ID
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role || role.deletedAt) {
      res.status(404).json({
        success: false,
        message: 'Role not found',
      });
      return;
    }

    const data: Prisma.RoleUpdateInput = {};

    // Validate and check duplicate role name
    if (roleName !== undefined) {
      if (!roleName.trim()) {
        res.status(400).json({
          success: false,
          message: 'Role name is required',
        });
        return;
      }

      const existingRole = await prisma.role.findFirst({
        where: {
          roleName: roleName.trim(),
          deletedAt: null,
          NOT: { id },
        },
      });

      if (existingRole) {
        res.status(400).json({
          success: false,
          message: 'Role name already exists',
        });
        return;
      }

      data.roleName = roleName.trim();
    }

    if (status !== undefined) {
      data.status = status;
    }

    // Validate defaultRoute (optional — only reject if provided but blank)
    if (defaultRoute !== undefined) {
      if (!defaultRoute.trim()) {
        res.status(400).json({
          success: false,
          message: 'Default route cannot be empty',
        });
        return;
      }
      (data as Prisma.RoleUpdateInput & { defaultRoute?: string }).defaultRoute =
        defaultRoute.trim();
    }

    const updated = await prisma.role.update({
      where: { id },
      data,
    });

    res.status(200).json({
      success: true,
      message: 'Role updated successfully',
      data: {
        id: updated.id,
        roleName: updated.roleName,
        status: updated.status,
        defaultRoute: (updated as unknown as { defaultRoute?: string | null }).defaultRoute,
        createdBy: updated.createdBy,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    console.error('Error updating role:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating role',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const role = await prisma.role.findUnique({ where: { id } });
    if (!role || role.deletedAt) {
      res.status(404).json({
        success: false,
        message: 'Role not found',
      });
      return;
    }

    // Guard: refuse to soft-delete a role that is still assigned to active
    // (non-deleted) users. Soft-deleted users are excluded so their stale
    // roleId FK doesn't block role cleanup.
    const userCount = await prisma.user.count({ where: { roleId: id, isDeleted: false } });
    if (userCount > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete role "${role.roleName}" – it is assigned to ${userCount} user${userCount === 1 ? '' : 's'}. Re-assign those users first.`,
      });
      return;
    }

    await prisma.role.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.status(200).json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (err) {
    console.error('Error deleting role:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting role',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createRole,
  getRoles,
  getAllRoles,
  updateRole,
  deleteRole,
  listUsersByRole,
};
module.exports.createRole = createRole;
module.exports.getRoles = getRoles;
module.exports.getAllRoles = getAllRoles;
module.exports.updateRole = updateRole;
module.exports.deleteRole = deleteRole;
module.exports.listUsersByRole = listUsersByRole;
