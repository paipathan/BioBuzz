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
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;
import com.pedropathing.ivy.commands.Commands;

public abstract class RedGardenAuto extends NextOpMode {
    private final Robot robot;
    private final RedGardenAutoPaths paths;

    protected RedGardenAuto(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new RedGardenAutoPaths(alliance);

        robot.initialize(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential(
                robot.set(Robot.State.IDLE),
                robot.flowerBar.set(FlowerBar.State.UP),
                Commands.waitMs(2000),
                robot.drivetrain.follow(paths.path1()),
                robot.set(Robot.State.SHOOT),
                Commands.waitMs(1000),
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.path2()),
                robot.set(Robot.State.INTAKE),
                robot.drivetrain.follow(paths.path3()),
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.path4()),
                robot.set(Robot.State.SHOOT),
                Commands.waitMs(1000),
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.path5()),
                robot.set(Robot.State.IDLE)
        );
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Red Garden Auto Red", preselectTeleop = "Red Teleop")
    public static class RedGardenAutoRed extends RedGardenAuto {
        public RedGardenAutoRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Red Garden Auto Blue", preselectTeleop = "Blue Teleop")
    public static class RedGardenAutoBlue extends RedGardenAuto {
        public RedGardenAutoBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class RedGardenAutoPaths {

        public final Pose start;
        private final Pose point1;
        private final Pose point2;
        private final Pose point3;
        private final Pose point4;
        private final Pose path4Control1;
        private final Pose point6;

        public RedGardenAutoPaths(Alliance alliance) {
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(60, 8.7, 90);
            point1 = poseFactory.of(60, 32.5, 90);
            point2 = poseFactory.of(27.2, 6.8, 180);
            point3 = poseFactory.of(8.7, 6.8, 180);
            point4 = poseFactory.of(60, 110.6, 270);
            path4Control1 = poseFactory.of(30.5, 129.6, 0);
            point6 = poseFactory.of(6.8, 123, 270);
        }

        public Path path1() {
            return Paths.line(start, point1).linear(start, point1);
        }

        public Path path2() {
            return Paths.line(point1, point2).linear(point1, point2);
        }

        public Path path3() {
            return Paths.line(point2, point3).linear(point2, point3);
        }

        public Path path4() {
            return Paths.curve(point3, path4Control1, point4).linear(point3, point4);
        }

        public Path path5() {
            return Paths.line(point4, point6).linear(point4, point6);
        }
    }
}
