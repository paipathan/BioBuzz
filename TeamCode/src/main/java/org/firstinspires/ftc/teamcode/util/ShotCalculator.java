package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.pedropathing.utils.Angle;

public class ShotCalculator {

    public static Pose goalPose;
    public static double turretAngle;
    public static double distance;

    public static void update(Follower follower, Alliance alliance) {
        update(follower.pose(), alliance);
    }

    public static void update(Pose robot, Alliance alliance) {
        goalPose = alliance == Alliance.RED ? Constants.ShotCalculator.redGoal : Constants.ShotCalculator.blueGoal;

        Pose turret = turretPosition(robot);
        double dx = goalPose.x() - turret.x();
        double dy = goalPose.y() - turret.y();

        turretAngle = Angle.normalizeSigned(Math.atan2(dy, dx) - robot.heading());
        distance = Math.hypot(dx, dy);
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
