import fs from 'fs';

import type { Request, Response } from 'express';
import type { UserGender } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { hashPassword } from '../utils/password';
import { requireTenantId } from '../lib/tenantScope';
import { OWNER_ROLE_NAME } from '../lib/defaultRoles';

/**
 * True when the target user is an owner of THIS workspace and the only one.
 *
 * This used to count `User.roleId === <the Owner role>` across the whole
 * install, which answered a different question in two ways: it looked at every
 * company's users, and it keyed on a role name that a workspace is free to
 * rename. The owner of a workspace is now recorded on the membership itself
 * (`TenantMembership.isOwner`), so that is what gets counted, within one tenant.
 */
async function isLastOwner(targetUserId: string, tenantId: string): Promise<boolean> {
  const target = await prisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId: targetUserId, tenantId } },
    select: { isOwner: true },
  });
  if (!target?.isOwner) return false;
  const owners = await prisma.tenantMembership.count({
    where: { tenantId, isOwner: true, status: 'ACTIVE' },
  });
  return owners <= 1;
}

/** The membership row binding a user to this workspace, or null if they are not in it. */
async function membershipIn(tenantId: string, userId: string) {
  return prisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { id: true, roleId: true, isOwner: true, status: true },
  });
}

function tryUnlink(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('Could not unlink upload', filePath, err);
  }
}

export async function createStaffUser(req: Request, res: Response): Promise<void> {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      gender,
      dateOfBirth,
      password,
      address,
      country,
      state,
      city,
      postalCode,
      roleId,
    } = req.body as {
      firstName: string;
      lastName?: string;
      email: string;
      phone?: string;
      gender?: UserGender;
      dateOfBirth?: string;
      password: string;
      address?: string;
      country?: string;
      state?: string;
      city?: string;
      postalCode?: string;
      roleId: string;
    };

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      tryUnlink(req.file?.path);
      res.status(400).json({
        success: false,
        message: 'Email is already registered',
      });
      return;
    }

    // Scoped: a role id from another workspace must not be attachable here.
    const role = await prisma.role.findFirst({
      where: { id: roleId, tenantId: requireTenantId(req), deletedAt: null },
    });
    if (!role) {
      tryUnlink(req.file?.path);
      res.status(404).json({
        success: false,
        message: 'Role not found',
      });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const tenantId = requireTenantId(req);

    // The MEMBERSHIP is what puts this person in the workspace — creating the
    // User alone would produce someone who cannot sign in, because
    // authMiddleware.protect resolves the tenant from the membership and 401s
    // without one. Both rows go in together so that state cannot exist.
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          gender: gender as UserGender | undefined,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          password: hashedPassword,
          address,
          countryId: country,
          stateId: state,
          cityId: city,
          postalCode,
          user_type: 3,
          lastTenantId: tenantId,
          profileImage: req.file ? req.file.path : null,
        },
      });

      await tx.tenantMembership.create({
        data: {
          userId: created.id,
          tenantId,
          roleId,
          status: 'ACTIVE',
          isOwner: false,
          invitedBy: req.user ?? null,
          joinedAt: new Date(),
        },
      });

      return created;
    });

    res.status(201).json({
      success: true,
      message: 'Staff user created successfully',
      data: {
        id: newUser.id,
        name: `${newUser.firstName} ${newUser.lastName ?? ''}`.trim(),
        email: newUser.email,
        role: role.roleName,
        profileImage: newUser.profileImage
          ? `${req.protocol}://${req.get('host')}/${newUser.profileImage.replace(/\\/g, '/')}`
          : null,
      },
    });
  } catch (err) {
    console.error('Staff creation error:', err);
    tryUnlink(req.file?.path);
    res.status(500).json({
      success: false,
      message: 'Error creating staff user',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}


export async function listStaffUsers(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(String(req.query.page ?? 1), 10);
    const limit = parseInt(String(req.query.limit ?? 10), 10);
    const search = ((req.query.search as string) ?? '').trim();

    // Optional filter by user_type (allows callers that previously relied on
    // type=3-only behaviour to pass ?user_type=3; without it all non-999 users
    // are returned).
    // Guard: if the param is not a valid integer (e.g. ?user_type=abc), ignore
    // the filter entirely rather than passing NaN to Prisma.
    const userTypeParam = req.query.user_type as string | undefined;
    const userTypeParsed = userTypeParam !== undefined ? parseInt(userTypeParam, 10) : undefined;
    const userTypeFilter = userTypeParsed !== undefined && !isNaN(userTypeParsed) ? userTypeParsed : undefined;

    // Tenant scope: the people who hold a membership in THIS workspace. This
    // used to be `id === tenantId OR ownerId === tenantId`, which only worked
    // while a tenant id was a user id and nobody belonged to two workspaces.
    // Membership is now the definition of "in this company", and it is the same
    // predicate authMiddleware.protect enforces — so this list can never offer
    // a user that protect would then refuse to authenticate.
    const tenantId = requireTenantId(req);

    // Exclude sys-bootstrap (type 999). Optionally narrow to a specific type.
    // The tenant scope lives in AND[] so it composes with the search OR[] below
    // (assigning where.OR for search would otherwise clobber the tenant filter).
    const where: Prisma.UserWhereInput = {
      NOT: { user_type: 999 },
      AND: [{ memberships: { some: { tenantId } } }],
      ...(userTypeFilter !== undefined ? { user_type: userTypeFilter } : {}),
    };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { firstName: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          // The role shown is the one held IN THIS WORKSPACE: the same person
          // may be an Owner here and Staff elsewhere, so User.role cannot
          // answer it.
          memberships: {
            where: { tenantId },
            take: 1,
            select: { role: { select: { id: true, roleName: true } } },
          },
        },
      }),
    ]);

    const formattedUsers = users.map((user) => ({
      id: user.id,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
      gender: user.gender || '',
      dateOfBirth: user.dateOfBirth || null,
      address: user.address || '',
      user_type: user.user_type,
      roleid: user.memberships[0]?.role?.id ?? '',
      roleName: user.memberships[0]?.role?.roleName ?? 'N/A',
      profileImage: user.profileImage
        ? `${req.protocol}://${req.get('host')}/${user.profileImage.replace(/\\/g, '/')}`
        : null,
      createdAt: user.createdAt,
    }));

    res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      data: {
        users: formattedUsers,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateStaffUser(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const {
      firstName,
      lastName,
      email,
      phone,
      gender,
      dateOfBirth,
      password,
      address,
      country,
      state,
      city,
      postalCode,
      roleId,
    } = req.body as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      gender?: UserGender;
      dateOfBirth?: string;
      password?: string;
      address?: string;
      country?: string;
      state?: string;
      city?: string;
      postalCode?: string;
      roleId?: string;
    };

    const tenantId = requireTenantId(req);

    // Scoped through the membership: a user id from another workspace must read
    // as "not found" here, not as an editable record.
    const membership = await membershipIn(tenantId, id);
    const user = membership ? await prisma.user.findUnique({ where: { id } }) : null;
    if (!user || !membership) {
      res.status(404).json({
        success: false,
        message: 'Staff user not found',
      });
      return;
    }

    // Guard: cannot remove the Owner role from this workspace's last owner.
    const ownerRole = await prisma.role.findFirst({
      where: {
        tenantId,
        roleName: { equals: OWNER_ROLE_NAME, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    const removingOwnerRole = !!ownerRole && roleId !== undefined && roleId !== ownerRole.id;
    if (removingOwnerRole && (await isLastOwner(id, tenantId))) {
      res.status(409).json({
        success: false,
        message: 'Cannot remove the Owner role from the last owner',
      });
      return;
    }

    // Check for email conflict if email is being updated
    if (email && email !== user.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash) {
        res.status(400).json({
          success: false,
          message: 'Email is already registered',
        });
        return;
      }
    }

    // Check role validity — within this workspace.
    if (roleId) {
      const role = await prisma.role.findFirst({
        where: { id: roleId, tenantId, deletedAt: null },
      });
      if (!role) {
        res.status(404).json({
          success: false,
          message: 'Role not found',
        });
        return;
      }
    }

    const data: Prisma.UserUpdateInput = {
      firstName: firstName || user.firstName,
      lastName: lastName || user.lastName,
      email: email || user.email,
      phone: phone || user.phone,
      gender: (gender as UserGender | undefined) || user.gender || undefined,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : user.dateOfBirth || undefined,
      address: address || user.address,
      postalCode: postalCode || user.postalCode,
    };

    if (country) {
      data.country = { connect: { id: country } };
    }
    if (state) {
      data.state = { connect: { id: state } };
    }
    if (city) {
      data.city = { connect: { id: city } };
    }
    // The role is NOT set here any more: it lives on the membership, and the
    // membership update below is what applies it. Writing it in both places
    // was how the two could disagree.

    // Update password if provided
    if (password) {
      data.password = await hashPassword(password);
    }

    // Update profile image if a new one is uploaded
    if (req.file) {
      if (user.profileImage && fs.existsSync(user.profileImage)) {
        fs.unlinkSync(user.profileImage);
      }
      data.profileImage = req.file.path;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id }, data });
      if (roleId) {
        // The membership is where a role assignment lives. The mirror onto
        // User.roleId that used to accompany this went with the column (P9).
        await tx.tenantMembership.update({
          where: { id: membership.id },
          data: {
            roleId,
            // Ownership follows the Owner role, so a workspace that promotes
            // someone does not end up with a role that says Owner and a
            // membership flag that says otherwise (which is what protect and
            // isLastOwner both read).
            ...(ownerRole ? { isOwner: roleId === ownerRole.id } : {}),
          },
        });
      }
      return row;
    });

    res.status(200).json({
      success: true,
      message: 'Staff user updated successfully',
      data: updated,
    });
  } catch (err) {
    console.error('Error updating staff user:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating staff user',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteStaffUser(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req);

    const membership = await membershipIn(tenantId, id);
    if (!membership) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    // Guard: cannot delete this workspace's last remaining owner.
    if (await isLastOwner(id, tenantId)) {
      res.status(409).json({
        success: false,
        message: 'Cannot delete the last owner',
      });
      return;
    }

    // A user can belong to several workspaces, so "remove from this company"
    // and "delete this person" stopped being the same operation. Removing the
    // membership is what this endpoint means; the User row only goes when the
    // membership removed was their last one, which keeps the single-tenant
    // behaviour identical while making the multi-tenant case correct.
    const alsoDeletedUser = await prisma.$transaction(async (tx) => {
      await tx.tenantMembership.delete({ where: { id: membership.id } });
      const remaining = await tx.tenantMembership.count({ where: { userId: id } });
      if (remaining > 0) return false;
      await tx.user.delete({ where: { id } });
      return true;
    });

    res.status(200).json({
      success: true,
      message: alsoDeletedUser
        ? 'Staff user permanently deleted successfully'
        : 'Staff user removed from this workspace',
    });
  } catch (err) {
    console.error('Error deleting staff user:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting staff user',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
