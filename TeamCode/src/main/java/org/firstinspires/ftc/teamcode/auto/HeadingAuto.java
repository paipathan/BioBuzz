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

public abstract class HeadingAuto extends NextOpMode {
    private final Robot robot;
    private final HeadingAutoPaths paths;

    protected HeadingAuto(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new HeadingAutoPaths(alliance);

        robot.initialize(paths.start, alliance);
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

    @NextAutonomous(name = "Heading Auto Red", preselectTeleop = "Red Teleop")
    public static class HeadingAutoRed extends HeadingAuto {
        public HeadingAutoRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Heading Auto Blue", preselectTeleop = "Blue Teleop")
    public static class HeadingAutoBlue extends HeadingAuto {
        public HeadingAutoBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class HeadingAutoPaths {

        public final Pose start;
        private final Pose point1;
        private final Alliance alliance;

        public HeadingAutoPaths(Alliance alliance) {
            this.alliance = alliance;
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(23.8, 23.5, 90);
            point1 = poseFactory.of(23.8, 120, 90);
        }

        public Path path1() {
            return withHeadingTargets(alliance, Paths.line(start, point1).linear(start, point1), headingTarget(0.5, 270));
        }
    }
}
