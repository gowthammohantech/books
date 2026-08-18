import type { Request, Response } from 'express';
import type { Module, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

interface PermissionInput {
  moduleId?: string;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  view?: boolean;
  allowAll?: boolean;
}

interface ModuleNode extends Module {
  children: ModuleNode[];
}

// -----------------------------
// Create or Update Permissions
// -----------------------------
export async function createOrUpdatePermissions(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { roleId, permissions, defaultRoute } = req.body as {
      roleId?: string;
      permissions?: PermissionInput[];
      defaultRoute?: string;
    };

    if (!roleId) {
      res.status(404).json({
        success: false,
        message: 'Role not found',
      });
      return;
    }

    // Validate role existence
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      res.status(404).json({
        success: false,
        message: 'Role not found',
      });
      return;
    }

    // Validate defaultRoute (optional — only reject if provided but blank),
    // mirroring roleController.ts's createRole/updateRole handling.
    if (defaultRoute !== undefined && !defaultRoute.trim()) {
      res.status(400).json({
        success: false,
        message: 'Default route cannot be empty',
      });
      return;
    }

    if (!Array.isArray(permissions) || permissions.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Permissions array is required',
      });
      return;
    }

    if (defaultRoute !== undefined) {
      await prisma.role.update({
        where: { id: roleId },
        data: { defaultRoute: defaultRoute.trim() } as Prisma.RoleUpdateInput & {
          defaultRoute?: string;
        },
      });
    }

    const updatedPermissions = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const perm of permissions) {
        if (!perm.moduleId) {
          throw new Error('__MISSING_MODULE_ID__');
        }

        const existingPermission = await tx.permission.findFirst({
          where: {
            roleId,
            moduleId: perm.moduleId,
            deletedAt: null,
          },
        });

        if (existingPermission) {
          const updated = await tx.permission.update({
            where: { id: existingPermission.id },
            data: {
              create: perm.create || false,
              edit: perm.edit || false,
              delete: perm.delete || false,
              view: perm.view || false,
              allowAll: perm.allowAll || false,
            },
          });
          results.push(updated);
        } else {
          const created = await tx.permission.create({
            data: {
              roleId,
              moduleId: perm.moduleId,
              create: perm.create || false,
              edit: perm.edit || false,
              delete: perm.delete || false,
              view: perm.view || false,
              allowAll: perm.allowAll || false,
            },
          });
          results.push(created);
        }
      }

      return results;
    });

    res.status(200).json({
      success: true,
      message: 'Permissions created or updated successfully',
      data: updatedPermissions,
      defaultRoute:
        defaultRoute !== undefined
          ? defaultRoute.trim()
          : (role as unknown as { defaultRoute?: string | null }).defaultRoute,
    });
  } catch (err) {
    if (err instanceof Error && err.message === '__MISSING_MODULE_ID__') {
      res.status(400).json({
        success: false,
        message: 'Each permission must have a moduleId',
      });
      return;
    }
    console.error('Error in createOrUpdatePermissions:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating/updating permissions',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getPermissionsByRole(req: Request, res: Response): Promise<void> {
  try {
    const { roleId } = req.params as { roleId: string };

    // Fetch role and validate existence
    const role = await prisma.role.findFirst({
      where: { id: roleId, deletedAt: null },
    });
    if (!role) {
      res.status(404).json({
        success: false,
        message: 'Role not found or has been deleted',
      });
      return;
    }

    // Fetch permissions with module details
    const permissions = await prisma.permission.findMany({
      where: { roleId, deletedAt: null },
      include: {
        module: {
          select: {
            id: true,
            moduleName: true,
            // The legacy code populated moduleName + status + timestamps,
            // but Module has no `status` column in the Prisma schema —
            // we expose the fields that do exist.
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Permissions fetched successfully',
      data: {
        roleId: role.id,
        roleName: role.roleName,
        defaultRoute: (role as unknown as { defaultRoute?: string | null }).defaultRoute,
        permissions,
      },
    });
  } catch (err) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching permissions',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getModuleHierarchy(_req: Request, res: Response): Promise<void> {
  try {
    const modules = await prisma.module.findMany({
      where: { deletedAt: null },
    });

    const moduleMap: Record<string, ModuleNode> = {};
    modules.forEach((mod) => {
      moduleMap[mod.id] = { ...mod, children: [] };
    });

    const hierarchy: ModuleNode[] = [];
    modules.forEach((mod) => {
      if (mod.parentId) {
        if (moduleMap[mod.parentId]) {
          moduleMap[mod.parentId].children.push(moduleMap[mod.id]);
        }
      } else {
        hierarchy.push(moduleMap[mod.id]);
      }
    });

    res.status(200).json({
      success: true,
      message: 'Modules fetched successfully',
      data: hierarchy,
    });
  } catch (error) {
    console.error('Error fetching module hierarchy:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching modules',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createOrUpdatePermissions,
  getModuleHierarchy,
  getPermissionsByRole,
};
module.exports.createOrUpdatePermissions = createOrUpdatePermissions;
module.exports.getModuleHierarchy = getModuleHierarchy;
module.exports.getPermissionsByRole = getPermissionsByRole;
