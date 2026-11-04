package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.api.PoseFactory;

public class Utilities {
    private Utilities() {}

    public static boolean inTolerance(double value, double target, double tolerance) {
        return Math.abs(value - target) <= tolerance;
    }

    public static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    public static PoseFactory poseFactory(Alliance alliance) {
        PoseFactory poseFactory = PoseFactory.degrees();
        if (alliance == Constants.Auto.drawnAlliance) return poseFactory;
        double center = Constants.Auto.fieldSize / 2;
        return poseFactory.mirrorAroundPoint(center, center);
    }
}
