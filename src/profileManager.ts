/**
 * @file profileManager.ts
 * @description Manages TestBench connection profiles, storing profile details in globalState
 * and passwords securely in SecretStorage.
 */

import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid"; // For generating unique profile IDs.
import { logger } from "./extension";

// Structure of a TestBench Profile
export interface TestBenchProfile {
    id: string; // Unique identifier for the profile (e.g., a UUID)
    label: string; // User-friendly name for the profile (e.g., "Dev Server", "Client X Prod")
    serverName: string;
    portNumber: number;
    username: string;
}

// Constants for storage keys
const PROFILES_STORAGE_KEY = "testbench.profiles";
const ACTIVE_PROFILE_ID_KEY = "testbench.activeProfileId";
const PROFILE_PASSWORD_SECRET_PREFIX = "testbench.profile.password."; // Prefix for storing passwords in SecretStorage

/**
 * Retrieves all saved TestBench profiles.
 * @param context The extension context.
 * @returns A promise that resolves to an array of TestBenchProfile objects.
 */
export async function getProfiles(context: vscode.ExtensionContext): Promise<TestBenchProfile[]> {
    try {
        const profiles = context.globalState.get<TestBenchProfile[]>(PROFILES_STORAGE_KEY, []);
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
 * @param context The extension context.
 * @param profile The profile data to save. The `id` can be omitted for new profiles.
 * @param password The password for the profile (optional, will be stored in SecretStorage).
 * @returns The ID of the saved profile.
 */
export async function saveProfile(
    context: vscode.ExtensionContext,
    profile: Omit<TestBenchProfile, "id"> & { id?: string }, // Allow id to be optional for new profiles
    password?: string
): Promise<string> {
    try {
        const profiles = await getProfiles(context);
        let profileToSave: TestBenchProfile;

        const existingProfileIndex = profile.id ? profiles.findIndex((p) => p.id === profile.id) : -1;

        if (existingProfileIndex !== -1 && profile.id) {
            // Update existing profile
            profileToSave = { ...profiles[existingProfileIndex], ...profile }; // Ensure all fields are merged
            profiles[existingProfileIndex] = profileToSave;
            logger.trace(`[ProfileManager] Updating profile: ${profileToSave.label} (ID: ${profileToSave.id})`);
        } else {
            // Add new profile
            const newId = uuidv4();
            profileToSave = { ...profile, id: newId } as TestBenchProfile; // Cast because 'id' is now guaranteed
            profiles.push(profileToSave);
            logger.trace(`[ProfileManager] Adding new profile: ${profileToSave.label} (ID: ${profileToSave.id})`);
        }

        await context.globalState.update(PROFILES_STORAGE_KEY, profiles);

        if (password !== undefined) {
            // Allow empty string password, but not undefined
            await context.secrets.store(PROFILE_PASSWORD_SECRET_PREFIX + profileToSave.id, password);
            logger.trace(`[ProfileManager] Password stored for profile ID: ${profileToSave.id}`);
        }
        return profileToSave.id;
    } catch (error) {
        logger.error("[ProfileManager] Error saving profile:", error);
        vscode.window.showErrorMessage(`Failed to save profile: ${(error as Error).message}`);
        throw error; // Re-throw to allow caller to handle
    }
}

/**
 * Deletes a TestBench profile and its associated password.
 * @param context The extension context.
 * @param profileId The ID of the profile to delete.
 */
export async function deleteProfile(context: vscode.ExtensionContext, profileId: string): Promise<void> {
    try {
        let profiles = await getProfiles(context);
        const initialLength = profiles.length;
        profiles = profiles.filter((p) => p.id !== profileId);

        if (profiles.length < initialLength) {
            await context.globalState.update(PROFILES_STORAGE_KEY, profiles);
            await context.secrets.delete(PROFILE_PASSWORD_SECRET_PREFIX + profileId);
            logger.trace(`[ProfileManager] Deleted profile with ID: ${profileId}`);

            // If the deleted profile was the active one, clear the active profile setting
            const activeProfileId = await getActiveProfileId(context);
            if (activeProfileId === profileId) {
                await setActiveProfileId(context, undefined);
                logger.trace("[ProfileManager] Cleared active profile as it was deleted.");
            }
        } else {
            logger.warn(`[ProfileManager] Profile with ID ${profileId} not found for deletion.`);
        }
    } catch (error) {
        logger.error("[ProfileManager] Error deleting profile:", error);
        vscode.window.showErrorMessage(`Failed to delete profile: ${(error as Error).message}`);
    }
}

/**
 * Retrieves the stored password for a given profile ID.
 * @param context The extension context.
 * @param profileId The ID of the profile.
 * @returns A promise that resolves to the password string, or undefined if not found or an error occurs.
 */
export async function getPasswordForProfile(
    context: vscode.ExtensionContext,
    profileId: string
): Promise<string | undefined> {
    try {
        const password = await context.secrets.get(PROFILE_PASSWORD_SECRET_PREFIX + profileId);
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
 * @param context The extension context.
 * @param profileId The ID of the profile to set as active, or undefined to clear the active profile.
 */
export async function setActiveProfileId(
    context: vscode.ExtensionContext,
    profileId: string | undefined
): Promise<void> {
    try {
        await context.globalState.update(ACTIVE_PROFILE_ID_KEY, profileId);
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
 * @param context The extension context.
 * @returns A promise that resolves to the active profile ID string, or undefined if none is set.
 */
export async function getActiveProfileId(context: vscode.ExtensionContext): Promise<string | undefined> {
    try {
        const activeId = context.globalState.get<string | undefined>(ACTIVE_PROFILE_ID_KEY);
        logger.trace(`[ProfileManager] Retrieved active profile ID: ${activeId}`);
        return activeId;
    } catch (error) {
        logger.error("[ProfileManager] Error retrieving active profile ID:", error);
        return undefined;
    }
}

/**
 * Retrieves the full details of the currently active TestBench profile.
 * @param context The extension context.
 * @returns A promise that resolves to the TestBenchProfile object if an active profile is set and found, otherwise undefined.
 */
export async function getActiveProfile(context: vscode.ExtensionContext): Promise<TestBenchProfile | undefined> {
    try {
        const activeId = await getActiveProfileId(context);
        if (activeId) {
            const profiles = await getProfiles(context);
            const activeProfile = profiles.find((p) => p.id === activeId);
            if (activeProfile) {
                logger.trace(`[ProfileManager] Active profile found: ${activeProfile.label}`);
                return activeProfile;
            } else {
                logger.warn(
                    `[ProfileManager] Active profile ID ${activeId} set, but profile not found in storage. Clearing active ID.`
                );
                await setActiveProfileId(context, undefined); // Clean up inconsistent state
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
 * @param context The extension context.
 */
export async function clearActiveProfile(context: vscode.ExtensionContext): Promise<void> {
    await setActiveProfileId(context, undefined);
}
