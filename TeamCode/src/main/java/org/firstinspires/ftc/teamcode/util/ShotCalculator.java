package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.pedropathing.utils.Angle;

public class ShotCalculator {

    public static final double RPM_STEP = 15;

    // true: RPM comes from the distance LUT plus the driver's dpad offset.
    // false: fixed RPM (defaultShooterRpm), nudged by the dpad. Each init starts from Constants.ShotCalculator.useLut.
    public static boolean useLut = Constants.ShotCalculator.useLut;
    // Driver's dpad nudge on top of the LUT.
    public static double rpmOffset = 0;
    // Fixed shooter speed, used when useLut is false.
    public static double defaultShooterRpm = Constants.Shooter.shotRpm;

    public static Pose goalPose;
    public static double turretAngle;
    public static double distance;
    public static double shooterRpm = defaultShooterRpm;

    /** Back to the configured mode and RPM; called on every robot init since these statics outlive an opmode. */
    public static void reset() {
        useLut = Constants.ShotCalculator.useLut;
        rpmOffset = 0;
        defaultShooterRpm = Constants.Shooter.shotRpm;
        shooterRpm = currentRpm();
    }

    public static void update(Follower follower, Alliance alliance) {
        update(follower.pose(), alliance);
    }

    public static void update(Pose robot, Alliance alliance) {
        goalPose = goalFor(robot, alliance);

        Pose turret = turretPosition(robot);
        double dx = goalPose.x() - turret.x();
        double dy = goalPose.y() - turret.y();

        turretAngle = Angle.normalizeSigned(Math.atan2(dy, dx) - robot.heading());
        distance = Math.hypot(dx, dy);
        shooterRpm = currentRpm();
    }

    /** Dpad nudge: shifts the LUT in LUT mode, or the hand-set RPM in tuner mode. */
    public static void adjustRpm(double delta) {
        if (useLut) {
            rpmOffset += delta;
            shooterRpm = currentRpm();
        } else {
            setDefaultRpm(defaultShooterRpm + delta);
        }
    }

    public static void setDefaultRpm(double rpm) {
        defaultShooterRpm = Math.max(0, rpm);
        shooterRpm = currentRpm();
    }

    /** Flywheel speed while idle, capped at the shot RPM so revving never has to coast down. */
    public static double idleRpm() {
        return Math.max(0, Math.min(Constants.Shooter.idleRpm, shooterRpm));
    }

    private static double currentRpm() {
        return useLut ? Math.max(0, lutRpm(distance) + rpmOffset) : defaultShooterRpm;
    }

    /**
     * Linear interpolation over Constants.ShotCalculator.lut (sorted by distance).
     * Outside the tuned range it holds the nearest end value instead of extrapolating.
     */
    public static double lutRpm(double distance) {
        double[][] lut = Constants.ShotCalculator.lut;
        if (distance <= lut[0][0]) return lut[0][1];
        for (int i = 1; i < lut.length; i++) {
            if (distance <= lut[i][0]) {
                double t = (distance - lut[i - 1][0]) / (lut[i][0] - lut[i - 1][0]);
                return lut[i - 1][1] + t * (lut[i][1] - lut[i - 1][1]);
            }
        }
        return lut[lut.length - 1][1];
    }

    public static Pose goalFor(Pose robot, Alliance alliance) {
        boolean low = robot.y() < Constants.ShotCalculator.goalSplitY;
        if (alliance == Alliance.RED) {
            return low ? Constants.ShotCalculator.redGoalLow : Constants.ShotCalculator.redGoalHigh;
        }
        return low ? Constants.ShotCalculator.blueGoalLow : Constants.ShotCalculator.blueGoalHigh;
    }

    public static Pose turretPosition(Pose robot) {
        Pose offset = Constants.Turret.turretOffset;
        double cos = Math.cos(robot.heading());
        double sin = Math.sin(robot.heading());
        return new Pose(
                robot.x() + offset.x() * cos - offset.y() * sin,
                robot.y() + offset.x() * sin + offset.y() * cos,
                robot.heading()
        );
    }
}
