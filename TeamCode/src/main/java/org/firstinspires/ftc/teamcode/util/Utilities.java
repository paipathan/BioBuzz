package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.math.Pose;

import dev.nextftc.hardware.actuators.NextMotor;

public class Utilities {
    private Utilities() {}

    public static boolean inTolerance(double value, double target, double tolerance) {
        return Math.abs(value - target) <= tolerance;
    }

    public static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Call on every init for a NextMotor that is reused across opmodes. NextMotor skips writes that
     * match its cached power, and that cache survives the opmode stop that zeroes the real motor, so
     * the first command of the next opmode could be silently dropped. Writing 0 brings the cache back
     * in line with the stopped motor.
     */
    public static void syncStoppedMotor(NextMotor motor) {
        motor.setThrottle(0.0);
        motor.update();
    }

    public static PoseFactory poseFactory(Alliance alliance) {
        PoseFactory poseFactory = PoseFactory.degrees();
        if (alliance == Constants.Auto.drawnAlliance) return poseFactory;
        double center = Constants.Auto.fieldSize / 2;
        return poseFactory.mirrorAroundPoint(center, center);
    }

    /** The wall pose gamepad A snaps to, mirrored for the given alliance. */
    public static Pose resetPose(Alliance alliance) {
        return poseFactory(alliance).of(
                Constants.Drivetrain.resetX, Constants.Drivetrain.resetY, Constants.Drivetrain.resetHeadingDeg);
    }
}
