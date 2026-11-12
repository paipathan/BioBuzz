package org.firstinspires.ftc.teamcode.auto;

import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.groups.Groups;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.robot.opmode.BulkReadHook;
import dev.nextftc.robot.opmode.NextAutonomous;
import dev.nextftc.robot.opmode.NextOpMode;
import static org.firstinspires.ftc.teamcode.util.PathEvents.headingTarget;
import static org.firstinspires.ftc.teamcode.util.PathEvents.withHeadingTargets;
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;
import com.pedropathing.ivy.commands.Commands;

public abstract class TwoTip extends NextOpMode {
    private final Robot robot;
    private final TwoTipPaths paths;

    protected TwoTip(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new TwoTipPaths(alliance);

        robot.initialize(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential(
                robot.set(Robot.State.IDLE),
                robot.flowerBar.set(FlowerBar.State.UP),
                robot.drivetrain.follow(paths.path1()),
                Commands.waitMs(1000),
                robot.drivetrain.follow(paths.path2()),
                Commands.waitMs(1000),
                robot.flowerBar.set(FlowerBar.State.DOWN),
                robot.drivetrain.follow(paths.path3()),
                Commands.waitMs(1000),
                robot.drivetrain.follow(paths.path4()),
                robot.flowerBar.set(FlowerBar.State.UP),
                Commands.waitMs(1000)
        );
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Two Tip Red", preselectTeleop = "Red Teleop")
    public static class TwoTipRed extends TwoTip {
        public TwoTipRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Two Tip Blue", preselectTeleop = "Blue Teleop")
    public static class TwoTipBlue extends TwoTip {
        public TwoTipBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class TwoTipPaths {

        public final Pose start;
        private final Pose point1;
        private final Pose point2;
        private final Pose path2Control1;
        private final Pose path2Control2;
        private final Pose point5;
        private final Pose point6;
        private final Pose path4Control1;
        private final Alliance alliance;

        public TwoTipPaths(Alliance alliance) {
            this.alliance = alliance;
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(48.1, 6.8, 0);
            point1 = poseFactory.of(10.7, 6.8, 0);
            point2 = poseFactory.of(48.1, 119.7, 270);
            path2Control1 = poseFactory.of(38.5, 38.9, 0);
            path2Control2 = poseFactory.of(18.8, 110.1, 0);
            point5 = poseFactory.of(48.1, 131.2, 270);
            point6 = poseFactory.of(10.7, 119.7, 180);
            path4Control1 = poseFactory.of(44.5, 117.2, 0);
        }

        public Path path1() {
            return Paths.line(start, point1).linear(start, point1);
        }

        public Path path2() {
            return withHeadingTargets(alliance, Paths.curve(point1, path2Control1, path2Control2, point2).linear(point1, point2), headingTarget(0.5, 270));
        }

        public Path path3() {
            return Paths.line(point2, point5).linear(point2, point5);
        }

        public Path path4() {
            return Paths.curve(point5, path4Control1, point6).linear(point5, point6);
        }
    }
}
