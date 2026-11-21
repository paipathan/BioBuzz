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
import static org.firstinspires.ftc.teamcode.util.PathEvents.follow;
import static org.firstinspires.ftc.teamcode.util.PathEvents.limit;
import com.pedropathing.ivy.commands.Commands;
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;
import static org.firstinspires.ftc.teamcode.util.PathEvents.headingTarget;
import static org.firstinspires.ftc.teamcode.util.PathEvents.withHeadingTargets;

public abstract class TwoTip extends NextOpMode {
    private final Robot robot;
    private final TwoTipPaths paths;

    protected TwoTip(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new TwoTipPaths(alliance);

        robot.initializeAuto(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential(
                robot.drivetrain.follow(paths.Shoot1()),
                robot.set(Robot.State.SHOOT),
                Commands.waitMs(3500),
                follow(robot, paths.CollectDepot1(), limit(0.7, 1, 0.35)),
                robot.set(Robot.State.INTAKE),
                Commands.waitMs(1000),
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.Shoot2()),
                robot.set(Robot.State.SHOOT),
                Commands.waitMs(3500),
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.CollectFlower1()),
                robot.flowerBar.set(FlowerBar.State.DOWN),
                robot.set(Robot.State.INTAKE),
                robot.drivetrain.follow(paths.CollectFlower2()),
                Commands.waitMs(1500),
                robot.drivetrain.follow(paths.Shoot3()),
                robot.flowerBar.set(FlowerBar.State.UP),
                robot.set(Robot.State.SHOOT),
                Commands.waitMs(3500),
                robot.set(Robot.State.IDLE),
                robot.drivetrain.follow(paths.Park())
        );
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Two Tip Red", preselectTeleop = Tele.RED)
    public static class TwoTipRed extends TwoTip {
        public TwoTipRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Two Tip Blue", preselectTeleop = Tele.BLUE)
    public static class TwoTipBlue extends TwoTip {
        public TwoTipBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class TwoTipPaths {

        public final Pose start;
        private final Pose point1;
        private final Pose point2;
        private final Pose CollectDepot1Control1;
        private final Pose point5;
        private final Pose Shoot2Control1;
        private final Pose point7;
        private final Pose point8;
        private final Pose Shoot2Control2;
        private final Pose point10;
        private final Alliance alliance;

        public TwoTipPaths(Alliance alliance) {
            this.alliance = alliance;
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(60, 8.8, 90);
            point1 = poseFactory.of(60, 24, 90);
            point2 = poseFactory.of(10.5, 7.4, 0);
            CollectDepot1Control1 = poseFactory.of(57.7, 6.8, 0);
            point5 = poseFactory.of(60, 115.7, 270);
            Shoot2Control1 = poseFactory.of(39, 35.4, 0);
            point7 = poseFactory.of(48.1, 123.2, 270);
            point8 = poseFactory.of(48.1, 130.7, 270);
            Shoot2Control2 = poseFactory.of(6.8, 115.7, 0);
            point10 = poseFactory.of(11.2, 115.7, 270);
        }

        public Path Shoot1() {
            return Paths.line(start, point1).linear(start, point1);
        }

        public Path CollectDepot1() {
            return withHeadingTargets(alliance, Paths.curve(point1, CollectDepot1Control1, point2).linear(point1, point2), headingTarget(0.235, 0));
        }

        public Path Shoot2() {
            return Paths.curve(point2, Shoot2Control1, Shoot2Control2, point5).linear(point2, point5);
        }

        public Path CollectFlower1() {
            return Paths.line(point5, point7).linear(point5, point7);
        }

        public Path CollectFlower2() {
            return Paths.line(point7, point8).linear(point7, point8);
        }

        public Path Shoot3() {
            return Paths.line(point8, point5).linear(point8, point5);
        }

        public Path Park() {
            return Paths.line(point5, point10).linear(point5, point10);
        }
    }
}