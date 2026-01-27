/**
 * Human-like Mouse Movement Library
 * 
 * Generates natural, human-like mouse movement paths using Bezier curves.
 * Based on ghost-cursor (https://github.com/Xetera/ghost-cursor)
 * 
 * Key features:
 * - Bezier curve paths (not straight lines)
 * - Fitts's Law for timing (distance/target size affects speed)
 * - Overshoot on long distances
 * - Configurable profiles for unique fingerprints
 */

import { Bezier } from 'bezier-js';

// ============================================================================
// Types
// ============================================================================

export interface Vector {
	x: number;
	y: number;
}

export interface TimedVector extends Vector {
	timestamp: number;
}

/**
 * Movement profile for creating unique fingerprints
 * All values are optional - defaults are used if not specified
 */
export interface MovementProfile {
	/** Speed multiplier (0.1 = very slow, 1 = normal, 2 = fast). Default: 1 */
	speed?: number;
	/** Curve spread/bendiness (2 = nearly straight, 200 = very curved). Default: auto based on distance */
	spread?: number;
	/** Overshoot distance threshold in pixels. Default: 500 */
	overshootThreshold?: number;
	/** Overshoot radius in pixels. Default: 120 */
	overshootRadius?: number;
	/** Minimum steps in path. Default: 25 */
	minSteps?: number;
	/** Random seed for reproducible paths (optional) */
	seed?: number;
	/** Add micro-jitter to simulate hand tremor. Default: false */
	jitter?: boolean;
	/** Jitter intensity (0-5 pixels). Default: 1 */
	jitterIntensity?: number;
}

export interface PathOptions {
	/** Override curve spread */
	spreadOverride?: number;
	/** Movement speed multiplier */
	moveSpeed?: number;
	/** Target width for Fitts's Law calculation */
	targetWidth?: number;
	/** Generate timestamps */
	useTimestamps?: boolean;
	/** Movement profile */
	profile?: MovementProfile;
}

export interface MoveOptions {
	/** Enable human-like movement (uses Bezier curves). Default: false */
	humanLike?: boolean;
	/** Movement profile for fine-tuning */
	profile?: MovementProfile;
	/** Duration in ms (only used when humanLike=false) */
	duration?: number;
}

// ============================================================================
// Vector Math
// ============================================================================

export const origin: Vector = { x: 0, y: 0 };

export const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y });
export const div = (a: Vector, b: number): Vector => ({ x: a.x / b, y: a.y / b });
export const mult = (a: Vector, b: number): Vector => ({ x: a.x * b, y: a.y * b });
export const add = (a: Vector, b: Vector): Vector => ({ x: a.x + b.x, y: a.y + b.y });

export const direction = (a: Vector, b: Vector): Vector => sub(b, a);
export const perpendicular = (a: Vector): Vector => ({ x: a.y, y: -1 * a.x });
export const magnitude = (a: Vector): number => Math.sqrt(Math.pow(a.x, 2) + Math.pow(a.y, 2));
export const unit = (a: Vector): Vector => div(a, magnitude(a));
export const setMagnitude = (a: Vector, amount: number): Vector => mult(unit(a), amount);

export const clamp = (target: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, target));

export const randomNumberRange = (min: number, max: number): number =>
	Math.random() * (max - min) + min;

// ============================================================================
// Bezier Curve Generation
// ============================================================================

/**
 * Get a random point along the line from a to b
 */
export const randomVectorOnLine = (a: Vector, b: Vector): Vector => {
	const vec = direction(a, b);
	const multiplier = Math.random();
	return add(a, mult(vec, multiplier));
};

/**
 * Generate a random normal line perpendicular to a-b
 */
const randomNormalLine = (a: Vector, b: Vector, range: number): [Vector, Vector] => {
	const randMid = randomVectorOnLine(a, b);
	const normalV = setMagnitude(perpendicular(direction(a, randMid)), range);
	return [randMid, normalV];
};

/**
 * Generate two anchor points for a Bezier curve
 * Both points are on the same side of the line (looks natural)
 */
export const generateBezierAnchors = (a: Vector, b: Vector, spread: number): [Vector, Vector] => {
	const side = Math.round(Math.random()) === 1 ? 1 : -1;
	const calc = (): Vector => {
		const [randMid, normalV] = randomNormalLine(a, b, spread);
		const choice = mult(normalV, side);
		return randomVectorOnLine(randMid, add(randMid, choice));
	};
	return [calc(), calc()].sort((p1, p2) => p1.x - p2.x) as [Vector, Vector];
};

/**
 * Create a Bezier curve between two points
 */
export const bezierCurve = (start: Vector, finish: Vector, spreadOverride?: number): Bezier => {
	const MIN_SPREAD = 2;
	const MAX_SPREAD = 200;
	const vec = direction(start, finish);
	const length = magnitude(vec);
	const spread = spreadOverride ?? clamp(length, MIN_SPREAD, MAX_SPREAD);
	const anchors = generateBezierAnchors(start, finish, spread);
	return new Bezier(start, ...anchors, finish);
};

/**
 * Calculate Bezier curve speed at parameter t
 */
export const bezierCurveSpeed = (t: number, P0: Vector, P1: Vector, P2: Vector, P3: Vector): number => {
	const B1 = 3 * (1 - t) ** 2 * (P1.x - P0.x) + 6 * (1 - t) * t * (P2.x - P1.x) + 3 * t ** 2 * (P3.x - P2.x);
	const B2 = 3 * (1 - t) ** 2 * (P1.y - P0.y) + 6 * (1 - t) * t * (P2.y - P1.y) + 3 * t ** 2 * (P3.y - P2.y);
	return Math.sqrt(B1 ** 2 + B2 ** 2);
};

// ============================================================================
// Fitts's Law
// ============================================================================

/**
 * Calculate movement time using Fitts's Law
 * https://en.wikipedia.org/wiki/Fitts%27s_law
 */
const fitts = (distance: number, width: number): number => {
	const a = 0;
	const b = 2;
	const id = Math.log2(distance / width + 1);
	return a + b * id;
};

// ============================================================================
// Overshoot
// ============================================================================

/**
 * Generate an overshoot point (past the target)
 */
export const overshoot = (coordinate: Vector, radius: number): Vector => {
	const a = Math.random() * 2 * Math.PI;
	const rad = radius * Math.sqrt(Math.random());
	const vector = { x: rad * Math.cos(a), y: rad * Math.sin(a) };
	return add(coordinate, vector);
};

/**
 * Check if overshoot should occur based on distance
 */
export const shouldOvershoot = (a: Vector, b: Vector, threshold: number): boolean =>
	magnitude(direction(a, b)) > threshold;

// ============================================================================
// Path Generation
// ============================================================================

/**
 * Add micro-jitter to simulate hand tremor
 */
const addJitter = (vectors: Vector[], intensity: number): Vector[] => {
	return vectors.map((v, i) => {
		// Don't jitter start and end points
		if (i === 0 || i === vectors.length - 1) return v;
		return {
			x: v.x + (Math.random() - 0.5) * intensity * 2,
			y: v.y + (Math.random() - 0.5) * intensity * 2,
		};
	});
};

/**
 * Clamp all vectors to positive values
 */
const clampPositive = (vectors: Vector[]): Vector[] => {
	return vectors.map((vector) => ({
		x: Math.max(0, vector.x),
		y: Math.max(0, vector.y),
	}));
};

/**
 * Generate a human-like path between two points
 */
export function generatePath(start: Vector, end: Vector, options?: PathOptions): Vector[] {
	const profile = options?.profile ?? {};
	const DEFAULT_WIDTH = 100;
	const MIN_STEPS = profile.minSteps ?? 15; // Reduced from 25 for faster movement

	const targetWidth = options?.targetWidth ?? DEFAULT_WIDTH;
	const curve = bezierCurve(start, end, options?.spreadOverride ?? profile.spread);
	const length = curve.length() * 0.8;

	// Calculate speed factor
	const speedMultiplier = profile.speed ?? 1;
	const moveSpeed = options?.moveSpeed ?? speedMultiplier;
	const speed = moveSpeed > 0 ? (25 / moveSpeed) : Math.random();
	const baseTime = speed * MIN_STEPS;

	// Calculate number of steps using Fitts's Law
	const steps = Math.ceil((Math.log2(fitts(length, targetWidth) + 1) + baseTime) * 3);

	// Get points along the curve
	let points = curve.getLUT(steps) as Vector[];
	points = clampPositive(points);

	// Add jitter if enabled
	if (profile.jitter) {
		const intensity = profile.jitterIntensity ?? 1;
		points = addJitter(points, intensity);
	}

	return points;
}

/**
 * Generate path with optional overshoot for long distances
 */
export function generatePathWithOvershoot(
	start: Vector,
	end: Vector,
	options?: PathOptions
): Vector[] {
	const profile = options?.profile ?? {};
	const overshootThreshold = profile.overshootThreshold ?? 500;
	const overshootRadius = profile.overshootRadius ?? 120;
	const overshootSpread = 10;

	if (shouldOvershoot(start, end, overshootThreshold)) {
		// First overshoot past the target
		const overshootPoint = overshoot(end, overshootRadius);
		const path1 = generatePath(start, overshootPoint, options);

		// Then come back to the actual target (with tighter curve)
		const path2 = generatePath(overshootPoint, end, {
			...options,
			spreadOverride: overshootSpread,
		});

		// Combine paths (skip duplicate point)
		return [...path1, ...path2.slice(1)];
	}

	return generatePath(start, end, options);
}

// ============================================================================
// High-Level Movement Functions
// ============================================================================

/**
 * Calculate delay between movement steps based on total duration and path length
 */
export function calculateStepDelay(pathLength: number, duration: number): number {
	return Math.max(1, duration / pathLength);
}

/**
 * Generate movement path based on options
 * Returns array of points and recommended delay between each
 */
export function planMovement(
	start: Vector,
	end: Vector,
	options: MoveOptions = {}
): { path: Vector[]; stepDelay: number } {
	const { humanLike = false, profile, duration = 500 } = options;

	if (!humanLike) {
		// Linear path (current behavior)
		const steps = Math.max(10, Math.floor(duration / 10));
		const deltaX = (end.x - start.x) / steps;
		const deltaY = (end.y - start.y) / steps;
		const path: Vector[] = [];

		for (let i = 0; i <= steps; i++) {
			path.push({
				x: Math.round(start.x + deltaX * i),
				y: Math.round(start.y + deltaY * i),
			});
		}

		return {
			path,
			stepDelay: duration / steps,
		};
	}

	// Human-like path with Bezier curves
	const speed = profile?.speed ?? 1;
	const effectiveDuration = duration / speed;

	const path = generatePathWithOvershoot(start, end, {
		profile,
		moveSpeed: speed,
	});

	// Round coordinates
	const roundedPath = path.map((p) => ({
		x: Math.round(p.x),
		y: Math.round(p.y),
	}));

	return {
		path: roundedPath,
		stepDelay: calculateStepDelay(roundedPath.length, effectiveDuration),
	};
}

// ============================================================================
// Default Profiles
// ============================================================================

export const PROFILES = {
	/** Normal human movement (faster default) */
	normal: {
		speed: 1.5,
		jitter: false,
		overshootThreshold: 800,
		minSteps: 15,
	} as MovementProfile,

	/** Fast, confident movement */
	fast: {
		speed: 2,
		jitter: false,
		overshootThreshold: 1000,
		minSteps: 10,
	} as MovementProfile,

	/** Slow, careful movement */
	slow: {
		speed: 0.6,
		jitter: true,
		jitterIntensity: 0.5,
		overshootThreshold: 400,
		minSteps: 30,
	} as MovementProfile,

	/** Elderly/hesitant movement */
	hesitant: {
		speed: 0.4,
		jitter: true,
		jitterIntensity: 2,
		overshootThreshold: 300,
		overshootRadius: 80,
		minSteps: 40,
	} as MovementProfile,

	/** Gaming/precise movement */
	precise: {
		speed: 1.2,
		jitter: false,
		overshootThreshold: 1000, // Rarely overshoot
		spread: 50, // Less curved
		minSteps: 15,
	} as MovementProfile,
};
