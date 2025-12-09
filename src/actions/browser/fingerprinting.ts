import { IPage } from "./drivers";
import { LOGGER } from "../../base/logger";

export interface FingerprintingConfig {
    enabled?: boolean;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    maxTouchPoints?: number;
    timezone?: string;
    language?: string;
    languages?: string[];
    locale?: string;
    profile?: string;
}

// Default Fingerprinting Profiles
export interface FingerprintingProfile {
    name: string;
    description: string;
    config: Omit<FingerprintingConfig, 'enabled' | 'profile'>;
}

export const DEFAULT_PROFILES: Record<string, FingerprintingProfile> = {
    // Windows Profiles
    'windows-enterprise': {
        name: 'Windows Enterprise',
        description: 'High-end Windows workstation (16 cores, 32GB RAM)',
        config: {
            hardwareConcurrency: 16,
            deviceMemory: 32,
            maxTouchPoints: 0,
            timezone: 'America/New_York',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'windows-standard': {
        name: 'Windows Standard',
        description: 'Standard Windows desktop (8 cores, 16GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 16,
            maxTouchPoints: 0,
            timezone: 'America/Chicago',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'windows-budget': {
        name: 'Windows Budget',
        description: 'Budget Windows PC (4 cores, 8GB RAM)',
        config: {
            hardwareConcurrency: 4,
            deviceMemory: 8,
            maxTouchPoints: 0,
            timezone: 'America/Los_Angeles',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },

    // Mac Profiles
    'mac-pro': {
        name: 'Mac Pro',
        description: 'High-end Mac Pro (12 cores, 32GB RAM)',
        config: {
            hardwareConcurrency: 12,
            deviceMemory: 32,
            maxTouchPoints: 0,
            timezone: 'America/Los_Angeles',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'macbook-pro': {
        name: 'MacBook Pro',
        description: 'MacBook Pro M1/M2 (8 cores, 16GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 16,
            maxTouchPoints: 0,
            timezone: 'America/New_York',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'macbook-air': {
        name: 'MacBook Air',
        description: 'MacBook Air M1 (8 cores, 8GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 8,
            maxTouchPoints: 0,
            timezone: 'America/Los_Angeles',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },

    // Linux Profiles
    'linux-server': {
        name: 'Linux Server',
        description: 'Linux server environment (16 cores, 32GB RAM)',
        config: {
            hardwareConcurrency: 16,
            deviceMemory: 32,
            maxTouchPoints: 0,
            timezone: 'UTC',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'linux-desktop': {
        name: 'Linux Desktop',
        description: 'Linux desktop workstation (8 cores, 16GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 16,
            maxTouchPoints: 0,
            timezone: 'America/New_York',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },

    // Mobile Profiles (Note: Mobile profiles are for reference - desktop browser won't use these)
    'android-flagship': {
        name: 'Android Flagship',
        description: 'High-end Android phone (8 cores, 6GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 6,
            maxTouchPoints: 10,
            timezone: 'America/New_York',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'android-standard': {
        name: 'Android Standard',
        description: 'Standard Android phone (8 cores, 4GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 4,
            maxTouchPoints: 10,
            timezone: 'America/Los_Angeles',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'iphone-pro': {
        name: 'iPhone Pro',
        description: 'iPhone Pro series (6 cores, 6GB RAM)',
        config: {
            hardwareConcurrency: 6,
            deviceMemory: 6,
            maxTouchPoints: 10,
            timezone: 'America/New_York',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },

    // Geographic Profiles
    'europe-standard': {
        name: 'Europe Standard',
        description: 'European user profile (8 cores, 16GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 16,
            maxTouchPoints: 0,
            timezone: 'Europe/London',
            language: 'en-GB',
            languages: ['en-GB', 'en-US', 'en']
        }
    },
    'asia-standard': {
        name: 'Asia Standard',
        description: 'Asian user profile (8 cores, 16GB RAM)',
        config: {
            hardwareConcurrency: 8,
            deviceMemory: 16,
            maxTouchPoints: 0,
            timezone: 'Asia/Tokyo',
            language: 'en-US',
            languages: ['en-US', 'ja-JP', 'en']
        }
    },

    // Specialized Profiles
    'gaming-rig': {
        name: 'Gaming Rig',
        description: 'High-performance gaming PC (16 cores, 32GB RAM)',
        config: {
            hardwareConcurrency: 16,
            deviceMemory: 32,
            maxTouchPoints: 0,
            timezone: 'America/New_York',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    },
    'developer-workstation': {
        name: 'Developer Workstation',
        description: 'Developer workstation (12 cores, 32GB RAM)',
        config: {
            hardwareConcurrency: 12,
            deviceMemory: 32,
            maxTouchPoints: 0,
            timezone: 'America/Los_Angeles',
            language: 'en-US',
            languages: ['en-US', 'en']
        }
    }
};

export class ProfileManager {
    /**
     * Get all available profiles
     */
    static getAvailableProfiles(): Record<string, FingerprintingProfile> {
        return DEFAULT_PROFILES;
    }

    /**
     * Get profile names and descriptions
     */
    static getProfileList(): Array<{name: string, key: string, description: string}> {
        return Object.entries(DEFAULT_PROFILES).map(([key, profile]) => ({
            key,
            name: profile.name,
            description: profile.description
        }));
    }

    /**
     * Get a specific profile by name
     */
    static getProfile(profileName: string): FingerprintingProfile | null {
        return DEFAULT_PROFILES[profileName] || null;
    }

    /**
     * Resolve fingerprinting configuration with profile support
     */
    static resolveConfig(config: FingerprintingConfig, requestCriteria?: {
        platform?: string;
        timezone?: string;
        language?: string;
        locale?: string;
    }): FingerprintingConfig {
        let profile: FingerprintingProfile | null = null;

        if (config.profile === 'random') {
            // Check if we have criteria to match against
            if (requestCriteria && (requestCriteria.platform || requestCriteria.timezone || requestCriteria.language || requestCriteria.locale)) {
                profile = this.getRandomProfileByCriteria(requestCriteria);
            } else {
                // Use weighted random selection
                profile = this.getRandomProfile();
            }
        } else if (config.profile) {
            // Use specified profile
            profile = this.getProfile(config.profile);
            if (!profile) {
                // Unknown profile, fallback to criteria-based or random selection
                if (requestCriteria && (requestCriteria.platform || requestCriteria.timezone || requestCriteria.language || requestCriteria.locale)) {
                    profile = this.getRandomProfileByCriteria(requestCriteria);
                } else {
                    profile = this.getRandomProfile();
                }
            }
        } else if (!this.hasManualConfig(config)) {
            // No profile specified and no manual config - check for criteria-based selection
            if (requestCriteria && (requestCriteria.platform || requestCriteria.timezone || requestCriteria.language || requestCriteria.locale)) {
                profile = this.getRandomProfileByCriteria(requestCriteria);
            } else {
                // Auto-select weighted random
                profile = this.getRandomProfile();
            }
        }

        // If no profile selected, return config as-is (manual configuration)
        if (!profile) {
            return config;
        }

        // Merge profile config with user overrides
        const resolvedConfig: FingerprintingConfig = {
            enabled: config.enabled !== undefined ? config.enabled : true,
            ...profile.config,
            // User overrides take precedence
            ...(config.hardwareConcurrency !== undefined && { hardwareConcurrency: config.hardwareConcurrency }),
            ...(config.deviceMemory !== undefined && { deviceMemory: config.deviceMemory }),
            ...(config.maxTouchPoints !== undefined && { maxTouchPoints: config.maxTouchPoints }),
            ...(config.timezone !== undefined && { timezone: config.timezone }),
            ...(config.language !== undefined && { language: config.language }),
            ...(config.languages !== undefined && { languages: config.languages })
        };

        return resolvedConfig;
    }

    /**
     * Check if config has manual fingerprinting settings
     */
    private static hasManualConfig(config: FingerprintingConfig): boolean {
        return !!(
            config.hardwareConcurrency !== undefined ||
            config.deviceMemory !== undefined ||
            config.maxTouchPoints !== undefined ||
            config.timezone !== undefined ||
            config.language !== undefined ||
            config.languages !== undefined
        );
    }

    /**
     * Profile weights for realistic distribution
     * Higher weight = more likely to be selected
     */
    private static readonly PROFILE_WEIGHTS: Record<string, number> = {
        // Most common profiles (high weight)
        'windows-standard': 25,      // Most common desktop
        'macbook-pro': 15,           // Popular Mac
        'windows-enterprise': 12,    // Common in business
        'android-standard': 10,      // Common mobile
        
        // Moderately common (medium weight)
        'macbook-air': 8,
        'windows-budget': 8,
        'linux-desktop': 6,
        'iphone-pro': 6,
        
        // Less common but realistic (lower weight)
        'android-flagship': 4,
        'mac-pro': 3,
        'developer-workstation': 2,
        'gaming-rig': 2,
        
        // Specialized/geographic (lowest weight)
        'linux-server': 1,
        'europe-standard': 1,
        'asia-standard': 1
    };

    /**
     * Get a weighted random profile (realistic distribution)
     */
    static getRandomProfile(): FingerprintingProfile {
        const totalWeight = Object.values(this.PROFILE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const [profileKey, weight] of Object.entries(this.PROFILE_WEIGHTS)) {
            random -= weight;
            if (random <= 0) {
                return DEFAULT_PROFILES[profileKey];
            }
        }
        
        // Fallback to most common profile
        return DEFAULT_PROFILES['windows-standard'];
    }



    /**
     * Get a random profile that matches specific criteria
     */
    static getRandomProfileByCriteria(criteria: {
        platform?: string;
        timezone?: string;
        language?: string;
        locale?: string;
    }): FingerprintingProfile {
        const matchingProfiles: Array<{key: string, profile: FingerprintingProfile, score: number}> = [];
        
        Object.entries(DEFAULT_PROFILES).forEach(([key, profile]) => {
            let score = 0;
            let matches = true;
            
            // Platform matching
            if (criteria.platform) {
                const platformLower = criteria.platform.toLowerCase();
                if (platformLower.includes('win') || platformLower.includes('windows')) {
                    if (key.startsWith('windows-')) score += 10;
                    else if (!key.startsWith('mac') && !key.startsWith('linux-') && !key.startsWith('android-') && !key.startsWith('iphone-')) score += 5;
                    else matches = false;
                } else if (platformLower.includes('mac') || platformLower.includes('darwin')) {
                    if (key.startsWith('mac')) score += 10;
                    else matches = false;
                } else if (platformLower.includes('linux')) {
                    if (key.startsWith('linux-')) score += 10;
                    else matches = false;
                } else if (platformLower.includes('android')) {
                    if (key.startsWith('android-')) score += 10;
                    else matches = false;
                } else if (platformLower.includes('ios') || platformLower.includes('iphone')) {
                    if (key.startsWith('iphone-')) score += 10;
                    else matches = false;
                }
            }
            
            // Timezone matching
            if (criteria.timezone && matches) {
                const tz = criteria.timezone;
                if (tz.includes('Europe/')) {
                    if (key === 'europe-standard') score += 15;
                    else if (key.startsWith('windows-') || key.startsWith('linux-')) score += 5;
                } else if (tz.includes('Asia/')) {
                    if (key === 'asia-standard') score += 15;
                    else if (key.startsWith('android-') || key.startsWith('linux-')) score += 5;
                } else if (tz.includes('America/')) {
                    if (key.startsWith('windows-') || key.startsWith('mac') || key.startsWith('iphone-')) score += 5;
                }
                
                // Check if profile's timezone matches
                if (profile.config.timezone === tz) {
                    score += 20;
                }
            }
            
            // Language matching
            if (criteria.language && matches) {
                const lang = criteria.language.toLowerCase();
                if (lang.startsWith('en-gb') || lang.startsWith('en-eu')) {
                    if (key === 'europe-standard') score += 10;
                } else if (lang.startsWith('ja') || lang.startsWith('ko') || lang.startsWith('zh')) {
                    if (key === 'asia-standard') score += 10;
                } else if (lang.startsWith('en-us') || lang.startsWith('en')) {
                    if (key.startsWith('windows-') || key.startsWith('mac') || key.startsWith('iphone-')) score += 5;
                }
                
                // Check if profile's language matches
                if (profile.config.language === criteria.language) {
                    score += 15;
                }
            }
            
            // Locale matching (similar to language but more specific)
            if (criteria.locale && matches) {
                const locale = criteria.locale.toLowerCase();
                if (locale.includes('en_gb') || locale.includes('en_eu')) {
                    if (key === 'europe-standard') score += 8;
                } else if (locale.includes('ja_jp') || locale.includes('ko_kr') || locale.includes('zh_cn')) {
                    if (key === 'asia-standard') score += 8;
                }
            }
            
            if (matches && score > 0) {
                matchingProfiles.push({ key, profile, score });
            }
        });
        
        // If no matches found, return weighted random
        if (matchingProfiles.length === 0) {
            return this.getRandomProfile();
        }
        
        // Sort by score (highest first) and apply weights
        matchingProfiles.sort((a, b) => b.score - a.score);
        
        // Create weighted selection from matching profiles
        const weightedMatches: Record<string, number> = {};
        matchingProfiles.forEach(({ key, score }) => {
            const baseWeight = this.PROFILE_WEIGHTS[key] || 1;
            // Boost weight based on match score
            weightedMatches[key] = baseWeight * (1 + score / 10);
        });
        
        const totalWeight = Object.values(weightedMatches).reduce((sum, weight) => sum + weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const [profileKey, weight] of Object.entries(weightedMatches)) {
            random -= weight;
            if (random <= 0) {
                return DEFAULT_PROFILES[profileKey];
            }
        }
        
        // Fallback to best match
        return matchingProfiles[0].profile;
    }

    /**
     * Get profiles by category
     */
    static getProfilesByCategory(category: 'windows' | 'mac' | 'linux' | 'mobile' | 'geographic' | 'specialized'): Record<string, FingerprintingProfile> {
        const categoryPrefixes: Record<string, string[]> = {
            windows: ['windows-'],
            mac: ['mac', 'macbook-'],
            linux: ['linux-'],
            mobile: ['android-', 'iphone-'],
            geographic: ['europe-', 'asia-'],
            specialized: ['gaming-', 'developer-']
        };

        const prefixes = categoryPrefixes[category] || [];
        const filtered: Record<string, FingerprintingProfile> = {};

        Object.entries(DEFAULT_PROFILES).forEach(([key, profile]) => {
            if (prefixes.some(prefix => key.startsWith(prefix))) {
                filtered[key] = profile;
            }
        });

        return filtered;
    }
}

/**
 * Comprehensive fingerprinting protection for browser pages
 */
export class FingerprintingProtection {
    private config: FingerprintingConfig;
    private sessionId: string;
    private actualUserAgent?: string;

    constructor(config: FingerprintingConfig = {}, requestCriteria?: {
        platform?: string;
        timezone?: string;
        language?: string;
        locale?: string;
    }, actualUserAgent?: string) {
        // Resolve configuration with profile support
        this.config = ProfileManager.resolveConfig({
            enabled: true,
            ...config
        }, requestCriteria);
        this.actualUserAgent = actualUserAgent;
        this.sessionId = Math.random().toString(36).substring(2, 15);
    }

    /**
     * Get the current configuration
     */
    getConfig(): FingerprintingConfig {
        return this.config;
    }

    /**
     * Apply all fingerprinting protections to a page
     */
    async applyProtections(page: IPage): Promise<void> {
        try {
            await Promise.all([
                this.spoofNavigatorObject(page),
                this.ensureTimezoneConsistency(page)
            ]);

            LOGGER.info("Applied minimal fingerprinting protections (navigator + timezone only)", {
                timezone: this.config.timezone,
                language: this.config.language,
                hardwareConcurrency: this.config.hardwareConcurrency
            });
        } catch (error) {
            LOGGER.error("Failed to apply fingerprinting protections", { error });
            throw error;
        }
    }

    /**
     * Apply protections immediately to current page (for navigation events)
     */
    async applyProtectionsImmediate(page: IPage): Promise<void> {
        try {
            await Promise.all([
                this.spoofNavigatorObjectImmediate(page),
                this.ensureTimezoneConsistencyImmediate(page)
            ]);

            LOGGER.info("Applied immediate fingerprinting protections after navigation", {
                timezone: this.config.timezone,
                language: this.config.language,
                hardwareConcurrency: this.config.hardwareConcurrency
            });
        } catch (error) {
            LOGGER.error("Failed to apply immediate fingerprinting protections", { error });
            throw error;
        }
    }

    /**
     * Spoof navigator object properties for consistency
     */
    private async spoofNavigatorObject(page: IPage): Promise<void> {
        await page.evaluateOnNewDocument((config: FingerprintingConfig, actualUserAgent?: string) => {
            // Use the actual UserAgent that was set at browser launch, or fall back to navigator.userAgent
            const userAgent = actualUserAgent || navigator.userAgent;
            const isChrome = userAgent.includes('Chrome');
            const isFirefox = userAgent.includes('Firefox');
            const isSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome');
            const isEdge = userAgent.includes('Edg');

            let vendor = 'Google Inc.';
            if (isSafari) vendor = 'Apple Computer, Inc.';
            if (isFirefox) vendor = '';
            if (isEdge) vendor = 'Microsoft Corporation';

            // Determine platform from user agent
            let detectedPlatform = 'win32';
            if (userAgent.includes('Mac')) detectedPlatform = 'darwin';
            else if (userAgent.includes('Linux')) detectedPlatform = 'linux';
            else if (userAgent.includes('Windows')) detectedPlatform = 'win32';

            interface PlatformInfo {
                platform: string;
                hardwareConcurrency: number;
                deviceMemory: number;
                maxTouchPoints: number;
            }

            const platformMap: Record<string, PlatformInfo> = {
                'win32': {
                    platform: 'Win32',
                    hardwareConcurrency: config.hardwareConcurrency || 8,
                    deviceMemory: config.deviceMemory || 8,
                    maxTouchPoints: config.maxTouchPoints || 0
                },
                'darwin': {
                    platform: 'MacIntel',
                    hardwareConcurrency: config.hardwareConcurrency || 8,
                    deviceMemory: config.deviceMemory || 8,
                    maxTouchPoints: config.maxTouchPoints || 0
                },
                'linux': {
                    platform: 'Linux x86_64',
                    hardwareConcurrency: config.hardwareConcurrency || 4,
                    deviceMemory: config.deviceMemory || 4,
                    maxTouchPoints: config.maxTouchPoints || 0
                }
            };

            const platformInfo = platformMap[detectedPlatform] || platformMap['win32'];

            const languages = [config.language];
            if (config.language !== 'en-US') {
                languages.push('en-US', 'en');
            } else {
                languages.push('en');
            }

            // Store the original user agent to ensure consistency
            const originalUserAgent = userAgent;
            
            Object.defineProperties(navigator, {
                userAgent: {
                    get: () => originalUserAgent,
                    configurable: true
                },
                appVersion: {
                    get: () => {
                        // Make appVersion perfectly consistent with userAgent
                        // appVersion should be everything after "Mozilla/"
                        if (originalUserAgent.startsWith('Mozilla/')) {
                            return originalUserAgent.substring(8); // Remove "Mozilla/"
                        }
                        return originalUserAgent;
                    },
                    configurable: true
                },
                appName: {
                    get: () => 'Netscape', // Chrome always reports as Netscape for compatibility
                    configurable: true
                },
                appCodeName: {
                    get: () => 'Mozilla',
                    configurable: true
                },
                product: {
                    get: () => 'Gecko',
                    configurable: true
                },
                platform: {
                    get: () => platformInfo.platform,
                    configurable: true
                },
                vendor: {
                    get: () => vendor,
                    configurable: true
                },
                vendorSub: {
                    get: () => '',
                    configurable: true
                },
                productSub: {
                    get: () => '20030107',
                    configurable: true
                },
                buildID: {
                    get: () => '20030107',
                    configurable: true
                },
                hardwareConcurrency: {
                    get: () => platformInfo.hardwareConcurrency,
                    configurable: true
                },
                deviceMemory: {
                    get: () => platformInfo.deviceMemory,
                    configurable: true
                },
                maxTouchPoints: {
                    get: () => platformInfo.maxTouchPoints,
                    configurable: true
                },
                languages: {
                    get: () => languages,
                    configurable: true
                },
                language: {
                    get: () => config.language,
                    configurable: true
                },
                webdriver: {
                    get: () => undefined,
                    configurable: true
                },
                cookieEnabled: {
                    get: () => true,
                    configurable: true
                },
                doNotTrack: {
                    get: () => null,
                    configurable: true
                },
                onLine: {
                    get: () => true,
                    configurable: true
                }
            });

            // Clean up automation traces more thoroughly
            try {
                delete (navigator as any).webdriver;
                delete (window as any).chrome?.runtime?.onConnect;
                delete (window as any).chrome?.runtime?.onMessage;
                
                // Hide other automation indicators and Brave-specific properties
                Object.defineProperty(window, 'chrome', {
                    get: () => ({
                        runtime: {},
                        loadTimes: () => ({}),
                        csi: () => ({})
                    }),
                    configurable: true
                });
                
                // Hide Brave-specific properties to appear as Chrome
                delete (window as unknown as { brave?: unknown }).brave;
                delete (navigator as unknown as { brave?: unknown }).brave;
                
                // Override any Brave-specific navigator properties
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => ({
                        brands: [
                            { brand: "Google Chrome", version: originalUserAgent.match(/Chrome\/([\d.]+)/)?.[1]?.split('.')[0] || "131" },
                            { brand: "Chromium", version: originalUserAgent.match(/Chrome\/([\d.]+)/)?.[1]?.split('.')[0] || "131" },
                            { brand: "Not_A Brand", version: "24" }
                        ],
                        mobile: false,
                        platform: platformInfo.platform
                    }),
                    configurable: true
                });
                
                // Override plugins with realistic Chrome plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        const plugins = [
                            { 
                                name: 'Chrome PDF Plugin', 
                                filename: 'internal-pdf-viewer',
                                description: 'Portable Document Format',
                                length: 1
                            },
                            { 
                                name: 'Chrome PDF Viewer', 
                                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                                description: '',
                                length: 1
                            },
                            { 
                                name: 'Native Client', 
                                filename: 'internal-nacl-plugin',
                                description: '',
                                length: 2
                            }
                        ];
                        
                        return {
                            ...plugins,
                            length: plugins.length,
                            item: (index: number) => plugins[index] || null,
                            namedItem: (name: string) => plugins.find(p => p.name === name) || null,
                            refresh: () => {}
                        };
                    },
                    configurable: true
                });
                
                // Override mimeTypes consistently
                Object.defineProperty(navigator, 'mimeTypes', {
                    get: () => {
                        const mimeTypes = [
                            { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
                            { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }
                        ];
                        
                        return {
                            ...mimeTypes,
                            length: mimeTypes.length,
                            item: (index: number) => mimeTypes[index] || null,
                            namedItem: (name: string) => mimeTypes.find(m => m.type === name) || null
                        };
                    },
                    configurable: true
                });
                
                // These properties are already defined above - no need to duplicate
                
            } catch (e) {
                // Ignore cleanup errors
            }

            if (navigator.permissions && navigator.permissions.query) {
                const originalQuery = navigator.permissions.query;
                navigator.permissions.query = (parameters: PermissionDescriptor) => {
                return originalQuery(parameters).then((result: PermissionStatus) => {
                        if (parameters.name === 'notifications') {
                            Object.defineProperty(result, 'state', { value: 'denied', writable: false });
                        }
                        return result;
                    });
                };
            }

            if ('connection' in navigator) {
                Object.defineProperties((navigator as any).connection, {
                    effectiveType: { get: () => '4g', configurable: true },
                    rtt: { get: () => 50, configurable: true },
                    downlink: { get: () => 10, configurable: true },
                    saveData: { get: () => false, configurable: true }
                });
            }

        }, this.config, this.actualUserAgent);
    }

    /**
     * Spoof navigator object properties immediately (for navigation events)
     */
    private async spoofNavigatorObjectImmediate(page: IPage): Promise<void> {
        await page.evaluate((config: FingerprintingConfig, actualUserAgent?: string) => {
            // Use the actual UserAgent that was set at browser launch, or fall back to navigator.userAgent
            const userAgent = actualUserAgent || navigator.userAgent;
            const isChrome = userAgent.includes('Chrome');
            const isFirefox = userAgent.includes('Firefox');
            const isSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome');
            const isEdge = userAgent.includes('Edg');

            let vendor = 'Google Inc.';
            if (isSafari) vendor = 'Apple Computer, Inc.';
            if (isFirefox) vendor = '';
            if (isEdge) vendor = 'Microsoft Corporation';

            // Determine platform from user agent
            let detectedPlatform = 'win32';
            if (userAgent.includes('Mac')) detectedPlatform = 'darwin';
            else if (userAgent.includes('Linux')) detectedPlatform = 'linux';
            else if (userAgent.includes('Windows')) detectedPlatform = 'win32';

            interface PlatformInfo {
                platform: string;
                hardwareConcurrency: number;
                deviceMemory: number;
                maxTouchPoints: number;
            }

            const platformMap: Record<string, PlatformInfo> = {
                'win32': {
                    platform: 'Win32',
                    hardwareConcurrency: config.hardwareConcurrency || 8,
                    deviceMemory: config.deviceMemory || 8,
                    maxTouchPoints: config.maxTouchPoints || 0
                },
                'darwin': {
                    platform: 'MacIntel',
                    hardwareConcurrency: config.hardwareConcurrency || 8,
                    deviceMemory: config.deviceMemory || 8,
                    maxTouchPoints: config.maxTouchPoints || 0
                },
                'linux': {
                    platform: 'Linux x86_64',
                    hardwareConcurrency: config.hardwareConcurrency || 4,
                    deviceMemory: config.deviceMemory || 4,
                    maxTouchPoints: config.maxTouchPoints || 0
                }
            };

            const platformInfo = platformMap[detectedPlatform] || platformMap['win32'];

            const languages = [config.language];
            if (config.language !== 'en-US') {
                languages.push('en-US', 'en');
            } else {
                languages.push('en');
            }

            // Store the original user agent to ensure consistency
            const originalUserAgent = userAgent;
            
            Object.defineProperties(navigator, {
                userAgent: {
                    get: () => originalUserAgent,
                    configurable: true
                },
                appVersion: {
                    get: () => {
                        // Make appVersion perfectly consistent with userAgent
                        // appVersion should be everything after "Mozilla/"
                        return originalUserAgent.startsWith('Mozilla/') 
                            ? originalUserAgent.substring(8) 
                            : originalUserAgent;
                    },
                    configurable: true
                },
                appName: {
                    get: () => 'Netscape', // Chrome always reports as Netscape for compatibility
                    configurable: true
                },
                appCodeName: {
                    get: () => 'Mozilla',
                    configurable: true
                },
                product: {
                    get: () => 'Gecko',
                    configurable: true
                },
                productSub: {
                    get: () => '20030107',
                    configurable: true
                },
                vendor: {
                    get: () => 'Google Inc.',
                    configurable: true
                },
                vendorSub: {
                    get: () => '',
                    configurable: true
                },
                buildID: {
                    get: () => '20030107',
                    configurable: true
                },
                platform: {
                    get: () => platformInfo.platform,
                    configurable: true
                },
                hardwareConcurrency: {
                    get: () => platformInfo.hardwareConcurrency,
                    configurable: true
                },
                deviceMemory: {
                    get: () => platformInfo.deviceMemory,
                    configurable: true
                },
                maxTouchPoints: {
                    get: () => platformInfo.maxTouchPoints,
                    configurable: true
                },
                languages: {
                    get: () => languages,
                    configurable: true
                },
                language: {
                    get: () => config.language,
                    configurable: true
                }
            });
            
            // Hide Brave-specific properties to appear as Chrome
            try {
                delete (window as unknown as { brave?: unknown }).brave;
                delete (navigator as unknown as { brave?: unknown }).brave;
                
                // Override any Brave-specific navigator properties
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => ({
                        brands: [
                            { brand: "Google Chrome", version: originalUserAgent.match(/Chrome\/([\d.]+)/)?.[1]?.split('.')[0] || "131" },
                            { brand: "Chromium", version: originalUserAgent.match(/Chrome\/([\d.]+)/)?.[1]?.split('.')[0] || "131" },
                            { brand: "Not_A Brand", version: "24" }
                        ],
                        mobile: false,
                        platform: platformInfo.platform
                    }),
                    configurable: true
                });
                
                // Override chrome object to hide automation indicators
                Object.defineProperty(window, 'chrome', {
                    get: () => ({
                        runtime: {},
                        loadTimes: () => ({}),
                        csi: () => ({})
                    }),
                    configurable: true
                });
            } catch (e) {
                // Ignore errors when hiding Brave properties
            }
            

        }, this.config, this.actualUserAgent);
    }



    /**
     * Ensure timezone consistency across all APIs
     */
    private async ensureTimezoneConsistency(page: IPage): Promise<void> {
        await page.evaluateOnNewDocument((timezone: string) => {
            // More comprehensive timezone offset mapping
            const getTimezoneOffsetMinutes = (tz: string) => {
                // Use native JavaScript to get the REAL current timezone offset for the given timezone
                // This automatically handles DST and gives us the exact offset that should match the IP location
                try {
                    const now = new Date();
                    const utc = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
                    
                    // Create a date in the target timezone
                    const targetTime = new Date(utc.toLocaleString("en-US", {timeZone: tz}));
                    const utcTime = new Date(utc.toLocaleString("en-US", {timeZone: "UTC"}));
                    
                    // Calculate the offset in minutes
                    const offsetMs = utcTime.getTime() - targetTime.getTime();
                    const offsetMinutes = Math.round(offsetMs / (1000 * 60));
                    
                    return offsetMinutes;
                } catch (error) {
                    // Failed to calculate timezone offset, using fallback
                    
                    // Fallback to static mapping (without DST consideration)
                    const timezones: Record<string, number> = {
                        // Americas (Standard Time - Winter)
                        'America/New_York': 300,       // EST (UTC-5) -> +300 minutes offset
                        'America/Los_Angeles': 480,    // PST (UTC-8) -> +480 minutes offset
                        'America/Chicago': 360,        // CST (UTC-6) -> +360 minutes offset
                        'America/Denver': 420,         // MST (UTC-7) -> +420 minutes offset
                        'America/Toronto': 300,        // EST (UTC-5) -> +300 minutes offset
                        'America/Vancouver': 480,      // PST (UTC-8) -> +480 minutes offset
                        
                        // Europe (Standard Time - Winter)
                        'Europe/London': 0,            // GMT (UTC+0) -> 0 minutes offset
                        'Europe/Paris': -60,           // CET (UTC+1) -> -60 minutes offset
                        'Europe/Berlin': -60,          // CET (UTC+1) -> -60 minutes offset
                        'Europe/Rome': -60,            // CET (UTC+1) -> -60 minutes offset
                        'Europe/Madrid': -60,          // CET (UTC+1) -> -60 minutes offset
                        'Europe/Amsterdam': -60,       // CET (UTC+1) -> -60 minutes offset
                        'Europe/Moscow': -180,         // MSK (UTC+3) -> -180 minutes offset
                        
                        // Asia (No DST for most)
                        'Asia/Tokyo': -540,            // JST (UTC+9) -> -540 minutes offset
                        'Asia/Shanghai': -480,         // CST (UTC+8) -> -480 minutes offset
                        'Asia/Hong_Kong': -480,        // HKT (UTC+8) -> -480 minutes offset
                        'Asia/Singapore': -480,        // SGT (UTC+8) -> -480 minutes offset
                        'Asia/Seoul': -540,            // KST (UTC+9) -> -540 minutes offset
                        'Asia/Dubai': -240,            // GST (UTC+4) -> -240 minutes offset
                        'Asia/Kolkata': -330,          // IST (UTC+5:30) -> -330 minutes offset
                        
                        // Australia/Oceania
                        'Australia/Sydney': -600,      // AEST (UTC+10) -> -600 minutes offset
                        'Australia/Melbourne': -600,   // AEST (UTC+10) -> -600 minutes offset
                        'Australia/Perth': -480,       // AWST (UTC+8) -> -480 minutes offset
                        
                        // Default fallbacks
                        'UTC': 0,
                        'GMT': 0
                    };
                    return timezones[tz] || 300; // Default to EST
                }
            };

            const timezoneOffset = getTimezoneOffsetMinutes(timezone);

            // Override Date.prototype.getTimezoneOffset
            Date.prototype.getTimezoneOffset = function() {
                return timezoneOffset;
            };

            // Override Intl.DateTimeFormat to use consistent timezone
            if (window.Intl && window.Intl.DateTimeFormat) {
                const OriginalDateTimeFormat = window.Intl.DateTimeFormat;
                window.Intl.DateTimeFormat = function(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
                    if (!options) options = {};
                    if (!options.timeZone) options.timeZone = timezone;
                    
                    const instance = new OriginalDateTimeFormat(locales, options);
                    
                    // Override resolvedOptions to always return our timezone
                    const originalResolvedOptions = instance.resolvedOptions;
                    instance.resolvedOptions = function() {
                        const resolved = originalResolvedOptions.call(this);
                        resolved.timeZone = timezone;
                        return resolved;
                    };
                    
                    return instance;
                } as typeof Intl.DateTimeFormat;
                
                // Copy static methods
                Object.keys(OriginalDateTimeFormat).forEach(key => {
                    (window.Intl.DateTimeFormat as unknown as Record<string, unknown>)[key] = (OriginalDateTimeFormat as unknown as Record<string, unknown>)[key];
                });
            }

            // Override Intl.RelativeTimeFormat if available
            if (window.Intl && (window.Intl as unknown as { RelativeTimeFormat?: unknown }).RelativeTimeFormat) {
                const OriginalRelativeTimeFormat = (window.Intl as unknown as { RelativeTimeFormat: new (locales?: string | string[], options?: Intl.RelativeTimeFormatOptions) => Intl.RelativeTimeFormat }).RelativeTimeFormat;
                (window.Intl as unknown as { RelativeTimeFormat: unknown }).RelativeTimeFormat = function(locales?: string | string[], options?: Intl.RelativeTimeFormatOptions) {
                    if (!options) options = {};
                    return new OriginalRelativeTimeFormat(locales, options);
                };
            }

            // Override performance.timeOrigin to be consistent
            if (window.performance && 'timeOrigin' in window.performance) {
                try {
                    Object.defineProperty(window.performance, 'timeOrigin', {
                        get: () => Date.now() - performance.now(),
                        configurable: true
                    });
                } catch (e) {
                    // Ignore if not configurable
                }
            }

        }, this.config.timezone || 'America/New_York'); // Keep original fallback for debugging
    }

    /**
     * Ensure timezone consistency immediately (for navigation events)
     */
    private async ensureTimezoneConsistencyImmediate(page: IPage): Promise<void> {
        await page.evaluate((timezone: string) => {
            // Get the REAL current timezone offset for the given timezone
            const getTimezoneOffsetMinutes = (tz: string) => {
                try {
                    const now = new Date();
                    const utc = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
                    
                    // Create a date in the target timezone
                    const targetTime = new Date(utc.toLocaleString("en-US", {timeZone: tz}));
                    const utcTime = new Date(utc.toLocaleString("en-US", {timeZone: "UTC"}));
                    
                    // Calculate the offset in minutes
                    const offsetMs = utcTime.getTime() - targetTime.getTime();
                    const offsetMinutes = Math.round(offsetMs / (1000 * 60));
                    
                    return offsetMinutes;
                } catch (error) {
                    // Fallback for invalid timezone
                    return 300; // Default to EST
                }
            };

            const timezoneOffset = getTimezoneOffsetMinutes(timezone);

            // Override Date.prototype.getTimezoneOffset
            Date.prototype.getTimezoneOffset = function() {
                return timezoneOffset;
            };

            // Override Intl.DateTimeFormat to use consistent timezone
            if (window.Intl && window.Intl.DateTimeFormat) {
                const OriginalDateTimeFormat = window.Intl.DateTimeFormat;
                window.Intl.DateTimeFormat = function(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
                    if (!options) options = {};
                    if (!options.timeZone) options.timeZone = timezone;
                    
                    const instance = new OriginalDateTimeFormat(locales, options);
                    
                    // Override resolvedOptions to always return our timezone
                    const originalResolvedOptions = instance.resolvedOptions;
                    instance.resolvedOptions = function() {
                        const resolved = originalResolvedOptions.call(this);
                        resolved.timeZone = timezone;
                        return resolved;
                    };
                    
                    return instance;
                } as typeof Intl.DateTimeFormat;
                
                // Copy static methods
                Object.keys(OriginalDateTimeFormat).forEach(key => {
                    (window.Intl.DateTimeFormat as unknown as Record<string, unknown>)[key] = (OriginalDateTimeFormat as unknown as Record<string, unknown>)[key];
                });
            }
             
         }, this.config.timezone || 'America/New_York');
     }
}

/**
 * Create fingerprinting protection instance from browser config
 */
export function createFingerprintingProtection(
    userAgent: string,
    platform: string,
    language: string,
    timezone: string,
    customHardware?: {
        hardwareConcurrency?: number;
        deviceMemory?: number;
        maxTouchPoints?: number;
    }
): FingerprintingProtection {
    const config: FingerprintingConfig = {
        language,
        timezone,
        hardwareConcurrency: customHardware?.hardwareConcurrency || (platform === 'linux' ? 4 : 8),
        deviceMemory: customHardware?.deviceMemory || (platform === 'linux' ? 4 : 8),
        maxTouchPoints: customHardware?.maxTouchPoints || 0
    };

    return new FingerprintingProtection(config, undefined, userAgent);
}

/**
 * IPInfo.io API response interface
 */
interface IPInfoResponse {
    ip: string;
    hostname?: string;
    city?: string;
    region?: string;
    country: string;
    loc?: string;
    org?: string;
    postal?: string;
    timezone: string;
    readme?: string;
}

/**
 * IP-based geolocation and timezone mapping using IPInfo.io
 */
export class IPGeolocation {
    private static readonly COUNTRY_LANGUAGE_MAP: Record<string, { language: string; locale: string }> = {
        // North America
        'US': { language: 'en-US', locale: 'en-US' },
        'CA': { language: 'en-CA', locale: 'en-CA' },
        'MX': { language: 'es-MX', locale: 'es-MX' },
        
        // Europe
        'GB': { language: 'en-GB', locale: 'en-GB' },
        'DE': { language: 'de-DE', locale: 'de-DE' },
        'FR': { language: 'fr-FR', locale: 'fr-FR' },
        'ES': { language: 'es-ES', locale: 'es-ES' },
        'IT': { language: 'it-IT', locale: 'it-IT' },
        'NL': { language: 'nl-NL', locale: 'nl-NL' },
        'RU': { language: 'ru-RU', locale: 'ru-RU' },
        'PT': { language: 'pt-PT', locale: 'pt-PT' },
        'PL': { language: 'pl-PL', locale: 'pl-PL' },
        'SE': { language: 'sv-SE', locale: 'sv-SE' },
        'NO': { language: 'nb-NO', locale: 'nb-NO' },
        'DK': { language: 'da-DK', locale: 'da-DK' },
        'FI': { language: 'fi-FI', locale: 'fi-FI' },
        
        // Asia Pacific
        'JP': { language: 'ja-JP', locale: 'ja-JP' },
        'CN': { language: 'zh-CN', locale: 'zh-CN' },
        'KR': { language: 'ko-KR', locale: 'ko-KR' },
        'IN': { language: 'en-IN', locale: 'en-IN' },
        'SG': { language: 'en-SG', locale: 'en-SG' },
        'HK': { language: 'zh-HK', locale: 'zh-HK' },
        'TW': { language: 'zh-TW', locale: 'zh-TW' },
        'AU': { language: 'en-AU', locale: 'en-AU' },
        'NZ': { language: 'en-NZ', locale: 'en-NZ' },
        'TH': { language: 'th-TH', locale: 'th-TH' },
        'VN': { language: 'vi-VN', locale: 'vi-VN' },
        'ID': { language: 'id-ID', locale: 'id-ID' },
        'MY': { language: 'ms-MY', locale: 'ms-MY' },
        'PH': { language: 'en-PH', locale: 'en-PH' },
        
        // South America
        'BR': { language: 'pt-BR', locale: 'pt-BR' },
        'AR': { language: 'es-AR', locale: 'es-AR' },
        'CL': { language: 'es-CL', locale: 'es-CL' },
        'CO': { language: 'es-CO', locale: 'es-CO' },
        'PE': { language: 'es-PE', locale: 'es-PE' },
        
        // Africa & Middle East
        'ZA': { language: 'en-ZA', locale: 'en-ZA' },
        'EG': { language: 'ar-EG', locale: 'ar-EG' },
        'SA': { language: 'ar-SA', locale: 'ar-SA' },
        'AE': { language: 'ar-AE', locale: 'ar-AE' },
        'IL': { language: 'he-IL', locale: 'he-IL' },
        'TR': { language: 'tr-TR', locale: 'tr-TR' },
        
        // Default fallback
        'DEFAULT': { language: 'en-US', locale: 'en-US' }
    };

    /**
     * Fetch IP geolocation data from IPInfo.io
     */
    static async fetchIPInfo(): Promise<IPInfoResponse | null> {
        try {
            // Always call IPInfo.io/json to get real public IP info
            const url = `https://ipinfo.io/json`;
            const response = await fetch(url);
            
            if (!response.ok) {
                return null;
            }

            const data: IPInfoResponse = await response.json();
            
            // Validate required fields
            if (!data.country || !data.timezone) {
                return null;
            }

            return data;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get language and locale from country code
     */
    static getLanguageFromCountry(countryCode: string): { language: string; locale: string } {
        return this.COUNTRY_LANGUAGE_MAP[countryCode] || this.COUNTRY_LANGUAGE_MAP['DEFAULT'];
    }

    /**
     * Adjust fingerprinting config based on client IP using IPInfo.io
     */
    static async adjustConfigForIP(config: FingerprintingConfig): Promise<FingerprintingConfig> {
        try {
            // Fetch real IP geolocation data
            const ipInfo = await this.fetchIPInfo();
            
            if (!ipInfo) {
                            // No IP info available, return original config
            return config;
            }

            // Get language/locale from country
            const countryLanguage = this.getLanguageFromCountry(ipInfo.country);
            
            // Create adjusted config that prioritizes IP-based values
            const adjustedConfig: FingerprintingConfig = {
                ...config,
                // Use IP-based timezone (IPInfo.io provides accurate timezone)
                timezone: ipInfo.timezone,
                // Use IP-based language if not explicitly set
                language: config.language || countryLanguage.language,
                // Use IP-based locale if not explicitly set
                locale: config.locale || countryLanguage.locale
            };
            


            return adjustedConfig;
        } catch (error) {
            return config; // Return original config on error
        }
    }
} 