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
import com.pedropathing.ivy.commands.Commands;
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;
import static org.firstinspires.ftc.teamcode.util.PathEvents.headingTarget;
import static org.firstinspires.ftc.teamcode.util.PathEvents.withHeadingTargets;

public abstract class RedFlowerRemake extends NextOpMode {
    private final Robot robot;
    private final RedFlowerRemakePaths paths;

    protected RedFlowerRemake(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new RedFlowerRemakePaths(alliance);

        robot.initializeAuto(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential(
                robot.set(Robot.State.IDLE),
                robot.flowerBar.set(FlowerBar.State.UP),
                robot.drivetrain.follow(paths.path1()),
                robot.set(Robot.State.SHOOT),
                Commands.waitMs(3500),
                robot.set(Robot.State.INTAKE),
                robot.flowerBar.set(FlowerBar.State.DOWN),
                robot.drivetrain.follow(paths.path2()),
                Commands.waitMs(3500),
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.path3())
        );
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Red Flower Remake Red", preselectTeleop = Tele.RED)
    public static class RedFlowerRemakeRed extends RedFlowerRemake {
        public RedFlowerRemakeRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Red Flower Remake Blue", preselectTeleop = Tele.BLUE)
    public static class RedFlowerRemakeBlue extends RedFlowerRemake {
        public RedFlowerRemakeBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class RedFlowerRemakePaths {

        public final Pose start;
        private final Pose point1;
        private final Pose point2;
        private final Pose point4;
        private final Pose path3Control1;
        private final Pose path2Control1;
        private final Pose path2Control2;
        private final Alliance alliance;

        public RedFlowerRemakePaths(Alliance alliance) {
            this.alliance = alliance;
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(60.1, 8.7, 90);
            point1 = poseFactory.of(60.1, 26.2, 90);
            point2 = poseFactory.of(12.7, 48, 0);
            point4 = poseFactory.of(14.5, 97.8, 90);
            path3Control1 = poseFactory.of(34.8, 54, 0);
            path2Control1 = poseFactory.of(29.9, 26.2, 0);
            path2Control2 = poseFactory.of(34.8, 51.1, 0);
        }

        public Path path1() {
            return Paths.line(start, point1).linear(start, point1);
        }

        public Path path2() {
            return withHeadingTargets(alliance, Paths.curve(point1, path2Control1, path2Control2, point2).linear(point1, point2), headingTarget(0.5, 0));
        }

        public Path path3() {
            return Paths.curve(point2, path3Control1, point4).linear(point2, point4);
        }
    }
}
