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
import com.pedropathing.ivy.commands.Commands;

public abstract class WaitPreloadTopLeft extends NextOpMode {
    private final Robot robot;
    private final WaitPreloadTopLeftPaths paths;

    protected WaitPreloadTopLeft(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new WaitPreloadTopLeftPaths(alliance);

        robot.initialize(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential(
                Commands.waitMs(15000),
                robot.drivetrain.follow(paths.path1()),
                robot.set(Robot.State.SHOOT),
                robot.drivetrain.follow(paths.path2())
        );
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Wait Preload Top Left Red", preselectTeleop = "Red Teleop")
    public static class WaitPreloadTopLeftRed extends WaitPreloadTopLeft {
        public WaitPreloadTopLeftRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Wait Preload Top Left Blue", preselectTeleop = "Blue Teleop")
    public static class WaitPreloadTopLeftBlue extends WaitPreloadTopLeft {
        public WaitPreloadTopLeftBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class WaitPreloadTopLeftPaths {

        public final Pose start;
        private final Pose point1;
        private final Pose path1Control1;
        private final Pose point3;

        public WaitPreloadTopLeftPaths(Alliance alliance) {
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(8.7, 137.2, 0);
            point1 = poseFactory.of(59.5, 116.2, 270);
            path1Control1 = poseFactory.of(39.5, 101.6, 0);
            point3 = poseFactory.of(8.7, 112.2, 270);
        }

        public Path path1() {
            return Paths.curve(start, path1Control1, point1).linear(start, point1);
        }

        public Path path2() {
            return Paths.line(point1, point3).linear(point1, point3);
        }
    }
}
