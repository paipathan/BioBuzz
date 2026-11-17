package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.pedropathing.utils.Angle;

public class ShotCalculator {

    public static final double RPM_STEP = 25;

    // Base shooter speed; nudged live from the driver's dpad.
    public static double defaultShooterRpm = 2950;

    public static Pose goalPose;
    public static double turretAngle;
    public static double distance;
    public static double shooterRpm = defaultShooterRpm;

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
        shooterRpm = defaultShooterRpm;
    }

    public static void adjustDefaultRpm(double delta) {
        defaultShooterRpm = Math.max(0, defaultShooterRpm + delta);
        shooterRpm = defaultShooterRpm;
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
