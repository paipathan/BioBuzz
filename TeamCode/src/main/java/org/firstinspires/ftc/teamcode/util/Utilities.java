package org.firstinspires.ftc.teamcode.util;

public class Utilities {
    private Utilities() {}

    public static boolean inTolerance(double value, double target, double tolerance) {
        return Math.abs(value - target) <= tolerance;
    }

    public static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
