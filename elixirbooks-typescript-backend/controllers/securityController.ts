import fs from 'fs';
import path from 'path';

import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { hashPassword, comparePassword } from '../utils/password';

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params as { userId: string };
    const { oldPassword, newPassword } = req.body as {
      oldPassword: string;
      newPassword: string;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    const isMatch = await comparePassword(oldPassword, user.password);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: 'Old password is incorrect',
      });
      return;
    }

    const hashed = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({
      success: false,
      message: 'Error resetting password',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params as { userId: string };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    if (user.profileImage) {
      const profileImagePath = path.join(__dirname, '../public', user.profileImage);
      if (fs.existsSync(profileImagePath)) {
        try {
          fs.unlinkSync(profileImagePath);
        } catch (fileErr) {
          console.warn('Could not unlink profile image', profileImagePath, fileErr);
        }
      }
    }

    await prisma.user.delete({ where: { id: userId } });

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting account',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getLoginActivitiesByUser(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { userId } = req.params as { userId: string };
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);

    const skip = (page - 1) * limit;

    const total = await prisma.loginActivity.count({ where: { userId } });

    const activities = await prisma.loginActivity.findMany({
      where: { userId },
      orderBy: { loginAt: 'desc' },
      skip,
      take: limit,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!activities.length) {
      res.status(404).json({
        success: false,
        message: 'No login activities found for this user',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Login activities fetched successfully',
      data: activities,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Error fetching login activities:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching login activities',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  resetPassword,
  deleteAccount,
  getLoginActivitiesByUser,
};
module.exports.resetPassword = resetPassword;
module.exports.deleteAccount = deleteAccount;
module.exports.getLoginActivitiesByUser = getLoginActivitiesByUser;
