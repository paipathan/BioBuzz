package org.firstinspires.ftc.teamcode.auto;

import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.groups.Groups;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.robot.opmode.NextOpMode;

public abstract class TwoTip extends NextOpMode {
    private final Robot robot;
    private final Alliance alliance;
    private final TwoTipPaths paths;

    protected TwoTip(Robot robot, Alliance alliance) {
        super(robot);
        this.robot = robot;
        this.alliance = alliance;
        this.paths = new TwoTipPaths(alliance);

        robot.initialize(paths.start);
    }

    private Command routine() {
        return Groups.sequential(
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.path1()),
                robot.drivetrain.follow(paths.path2()),
                robot.drivetrain.follow(paths.path3())
        );
    }

    @Override
    public void disabledPeriodic() {
        ShotCalculator.update(robot.drivetrain.getFollower(), alliance);
        robot.drivetrain.periodic();
    }

    @Override
    public void start() { routine().schedule(); }

    @Override
    public void periodic() { ShotCalculator.update(robot.drivetrain.getFollower(), alliance); }

    public static class TwoTipPaths {

        public final Pose start;
        private final Pose point1;
        private final Pose point2;
        private final Pose point3;
        private final Pose path2Control1;
        private final Pose path2Control2;

        public TwoTipPaths(Alliance alliance) {
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(12.3, 23.5, 90);
            point1 = poseFactory.of(12.3, 8.7, 90);
            point2 = poseFactory.of(47.9, 121, 270);
            point3 = poseFactory.of(14.9, 108.2, 0);
            path2Control1 = poseFactory.of(27.6, 46.5, 0);
            path2Control2 = poseFactory.of(15.1, 91.8, 0);
        }

        public Path path1() {
            return Paths.line(start, point1).linear(start, point1);
        }

        public Path path2() {
            return Paths.curve(point1, path2Control1, path2Control2, point2).linear(point1, point2);
        }

        public Path path3() {
            return Paths.line(point2, point3).linear(point2, point3);
        }
    }
}
