import type { UserExportPreference } from "@prisma/client";

import { userRepository } from "../repositories/user.repository";
import { ApiError } from "../utils/api-error";

export class MeService {
  private mapExportPreference(preference: UserExportPreference): "auto" | "manual" {
    return preference === "AUTO" ? "auto" : "manual";
  }

  private toDbExportPreference(preference: "auto" | "manual"): UserExportPreference {
    return preference === "auto" ? "AUTO" : "MANUAL";
  }

  async getMe(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new ApiError(404, "NOT_FOUND", "User not found");
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      exportPreference: this.mapExportPreference(user.exportPreference),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      googleConnection: {
        isConnected: Boolean(user.googleAccount && !user.googleAccount.revokedAt),
        googleEmail: user.googleAccount?.googleEmail ?? null,
        scopes: user.googleAccount?.scopes ?? [],
        tokenExpiresAt: user.googleAccount?.tokenExpiresAt ?? null,
        revokedAt: user.googleAccount?.revokedAt ?? null,
      },
    };
  }

  async updateMe(userId: string, exportPreference: "auto" | "manual") {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new ApiError(404, "NOT_FOUND", "User not found");
    }

    await userRepository.updateById(userId, {
      exportPreference: this.toDbExportPreference(exportPreference),
    });

    return this.getMe(userId);
  }

  async deleteMe(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new ApiError(404, "NOT_FOUND", "User not found");
    }

    await userRepository.softDeleteById(userId);
    return { deleted: true };
  }
}

export const meService = new MeService();
