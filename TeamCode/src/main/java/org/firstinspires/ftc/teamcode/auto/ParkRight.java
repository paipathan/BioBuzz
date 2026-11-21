package org.firstinspires.ftc.teamcode.auto;

import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.groups.Groups;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.teleop.Tele;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.robot.opmode.BulkReadHook;
import dev.nextftc.robot.opmode.NextAutonomous;
import dev.nextftc.robot.opmode.NextOpMode;
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;

public abstract class ParkRight extends NextOpMode {
    private final Robot robot;
    private final ParkRightPaths paths;

    protected ParkRight(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new ParkRightPaths(alliance);

        robot.initializeAuto(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential(
                robot.set(Robot.State.IDLE),
                robot.flowerBar.set(FlowerBar.State.UP),
                robot.drivetrain.follow(paths.path1())
        );
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Park Right Red", preselectTeleop = Tele.RED)
    public static class ParkRightRed extends ParkRight {
        public ParkRightRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Park Right Blue", preselectTeleop = Tele.BLUE)
    public static class ParkRightBlue extends ParkRight {
        public ParkRightBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class ParkRightPaths {

        public final Pose start;
        private final Pose point1;

        public ParkRightPaths(Alliance alliance) {
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(6.8, 80.6, 90);
            point1 = poseFactory.of(6.8, 92.2, 90);
        }

        public Path path1() {
            return Paths.line(start, point1).linear(start, point1);
        }
    }
}
