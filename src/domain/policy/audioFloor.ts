/**
 * The level Go live gates on, and the level the meter draws its floor notch at.
 *
 * One constant, because it was briefly two: the status line tested
 * `audioLevel > 0` while the control tested `>= 0.05`, so between those values
 * the line said "Tap to go live" while the button said "Needs audio". Two
 * authorities on one question is the §2 mistake in miniature.
 */
export const AUDIO_FLOOR = 0.05;
