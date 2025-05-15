/**
 * @file profileManager.ts
 * @description Manages TestBench connection profiles, storing profile details in globalState
 * and passwords securely in SecretStorage.
 */

import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./extension";
import { StorageKeys } from "./constants";

export interface TestBenchProfile {
    id: string; // Unique identifier for the profile (e.g., a UUID)
    label: string; // User-friendly name for the profile (e.g., "Dev Server", "Client X Prod")
    serverName: string;
    portNumber: number;
    username: string;
}

/**
 * Retrieves all saved TestBench profiles.
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {Promise<TestBenchProfile[]>} A promise that resolves to an array of TestBenchProfile objects.
 */
export async function getProfiles(context: vscode.ExtensionContext): Promise<TestBenchProfile[]> {
    try {
        const profiles: TestBenchProfile[] = context.globalState.get<TestBenchProfile[]>(
            StorageKeys.PROFILES_STORAGE_KEY,
            []
        );
        logger.trace(`[ProfileManager] Retrieved ${profiles.length} profiles.`);
        return profiles;
    } catch (error) {
        logger.error("[ProfileManager] Error retrieving profiles:", error);
        return [];
    }
}

/**
 * Saves or updates a TestBench profile.
 * If it's a new profile (no id or id not found), a new id will be generated.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param profile The profile data to save. The `id` can be omitted for new profiles.
 * @param {string} password The password for the profile (optional, will be stored in SecretStorage).
 * @returns {Promise<string>} The ID of the saved profile.
 */
export async function saveProfile(
    context: vscode.ExtensionContext,
    profile: Omit<TestBenchProfile, "id"> & { id?: string }, // Allow id to be optional for new profiles
    password?: string
): Promise<string> {
    try {
        const profiles: TestBenchProfile[] = await getProfiles(context);
        let profileToSave: TestBenchProfile;

        const existingProfileIndex: number = profile.id ? profiles.findIndex((p) => p.id === profile.id) : -1;

        if (existingProfileIndex !== -1 && profile.id) {
            // Update existing profile
            profileToSave = { ...profiles[existingProfileIndex], ...profile };
            profiles[existingProfileIndex] = profileToSave;
            logger.trace(`[ProfileManager] Updating profile: ${profileToSave.label} (ID: ${profileToSave.id})`);
        } else {
            // Add new profile
            const newId: string = uuidv4();
            profileToSave = { ...profile, id: newId } as TestBenchProfile; // Cast because 'id' is now guaranteed
            profiles.push(profileToSave);
            logger.trace(`[ProfileManager] Adding new profile: ${profileToSave.label} (ID: ${profileToSave.id})`);
        }

        await context.globalState.update(StorageKeys.PROFILES_STORAGE_KEY, profiles);

        // Allow empty string password, but not undefined
        if (password !== undefined) {
            await context.secrets.store(StorageKeys.PROFILE_PASSWORD_SECRET_PREFIX + profileToSave.id, password);
            logger.trace(`[ProfileManager] Password stored for profile ID: ${profileToSave.id}`);
        }
        return profileToSave.id;
    } catch (error) {
        logger.error("[ProfileManager] Error saving profile:", error);
        vscode.window.showErrorMessage(`Failed to save profile: ${(error as Error).message}`);
        throw error;
    }
}

/**
 * Deletes a TestBench profile and its associated password.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} profileIdToDelete The ID of the profile to delete.
 */
export async function deleteProfile(context: vscode.ExtensionContext, profileIdToDelete: string): Promise<void> {
    try {
        let profiles: TestBenchProfile[] = await getProfiles(context);
        const initialLength: number = profiles.length;
        profiles = profiles.filter((p) => p.id !== profileIdToDelete);

        if (profiles.length < initialLength) {
            await context.globalState.update(StorageKeys.PROFILES_STORAGE_KEY, profiles);
            await context.secrets.delete(StorageKeys.PROFILE_PASSWORD_SECRET_PREFIX + profileIdToDelete);
            logger.trace(`[ProfileManager] Deleted profile with ID: ${profileIdToDelete}`);

            const activeProfileId: string | undefined = await getActiveProfileId(context);
            if (activeProfileId === profileIdToDelete) {
                await setActiveProfileId(context, undefined);
                logger.trace("[ProfileManager] Cleared active profile as it was deleted.");
            }
        } else {
            logger.warn(`[ProfileManager] Profile with ID ${profileIdToDelete} not found for deletion.`);
        }
    } catch (error) {
        logger.error("[ProfileManager] Error deleting profile:", error);
        vscode.window.showErrorMessage(`Failed to delete profile: ${(error as Error).message}`);
    }
}

/**
 * Retrieves the stored password for a given profile ID.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} profileId The ID of the profile.
 * @returns A promise that resolves to the password string, or undefined if not found or an error occurs.
 */
export async function getPasswordForProfile(
    context: vscode.ExtensionContext,
    profileId: string
): Promise<string | undefined> {
    try {
        const password: string | undefined = await context.secrets.get(
            StorageKeys.PROFILE_PASSWORD_SECRET_PREFIX + profileId
        );
        if (password) {
            logger.trace(`[ProfileManager] Password retrieved for profile ID: ${profileId}`);
        } else {
            logger.trace(`[ProfileManager] No password found for profile ID: ${profileId}`);
        }
        return password;
    } catch (error) {
        logger.error("[ProfileManager] Error retrieving password for profile:", error);
        return undefined;
    }
}

/**
 * Sets the ID of the currently active TestBench profile.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string | undefined} profileId The ID of the profile to set as active, or undefined to clear the active profile.
 */
export async function setActiveProfileId(
    context: vscode.ExtensionContext,
    profileId: string | undefined
): Promise<void> {
    try {
        await context.globalState.update(StorageKeys.ACTIVE_PROFILE_ID_KEY, profileId);
        if (profileId) {
            logger.trace(`[ProfileManager] Active profile ID set to: ${profileId}`);
        } else {
            logger.trace("[ProfileManager] Active profile ID cleared.");
        }
    } catch (error) {
        logger.error("[ProfileManager] Error setting active profile ID:", error);
    }
}

/**
 * Gets the ID of the currently active TestBench profile.
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {Promise<string | undefined>} A promise that resolves to the active profile ID string, or undefined if none is set.
 */
export async function getActiveProfileId(context: vscode.ExtensionContext): Promise<string | undefined> {
    try {
        const activeId = context.globalState.get<string | undefined>(StorageKeys.ACTIVE_PROFILE_ID_KEY);
        logger.trace(`[ProfileManager] Retrieved active profile ID: ${activeId}`);
        return activeId;
    } catch (error) {
        logger.error("[ProfileManager] Error retrieving active profile ID:", error);
        return undefined;
    }
}

/**
 * Retrieves the full details of the currently active TestBench profile.
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {Promise<TestBenchProfile | undefined>} A promise that resolves to the TestBenchProfile object if an active profile is set and found, otherwise undefined.
 */
export async function getActiveProfile(context: vscode.ExtensionContext): Promise<TestBenchProfile | undefined> {
    try {
        const activeId: string | undefined = await getActiveProfileId(context);
        if (activeId) {
            const profiles: TestBenchProfile[] = await getProfiles(context);
            const activeProfile: TestBenchProfile | undefined = profiles.find((p) => p.id === activeId);
            if (activeProfile) {
                logger.trace(`[ProfileManager] Active profile found: ${activeProfile.label}`);
                return activeProfile;
            } else {
                logger.warn(
                    `[ProfileManager] Active profile ID ${activeId} set, but profile not found in storage. Clearing active ID.`
                );
                await setActiveProfileId(context, undefined);
            }
        }
        logger.trace("[ProfileManager] No active profile found.");
        return undefined;
    } catch (error) {
        logger.error("[ProfileManager] Error retrieving active profile details:", error);
        return undefined;
    }
}

/**
 * Clears the currently set active profile.
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function clearActiveProfile(context: vscode.ExtensionContext): Promise<void> {
    await setActiveProfileId(context, undefined);
}

/**
 * Checks if a profile with the given credentials (server, port, username) already exists.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} serverName The server name to check.
 * @param {number} portNumber The port number to check.
 * @param {string} username The username to check.
 * @returns {Promise<TestBenchProfile | undefined>} A promise that resolves to the existing TestBenchProfile if a duplicate is found, otherwise undefined.
 */
export async function findProfileByCredentials(
    context: vscode.ExtensionContext,
    serverName: string,
    portNumber: number,
    username: string
): Promise<TestBenchProfile | undefined> {
    try {
        const profiles: TestBenchProfile[] = await getProfiles(context);
        for (const profile of profiles) {
            if (
                profile.serverName.toLowerCase() === serverName.toLowerCase() &&
                profile.portNumber === portNumber &&
                profile.username.toLowerCase() === username.toLowerCase()
            ) {
                logger.trace(
                    `[ProfileManager] Found existing profile with matching server/user: ${profile.label} (ID: ${profile.id})`
                );
                return profile;
            }
        }
        logger.trace(`[ProfileManager] No existing profile found with the provided server/user.`);
        return undefined;
    } catch (error) {
        logger.error("[ProfileManager] Error checking for duplicate profile by server/user:", error);
        return undefined;
    }
}
