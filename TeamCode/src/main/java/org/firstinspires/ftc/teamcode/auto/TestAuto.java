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
import static org.firstinspires.ftc.teamcode.util.PathEvents.follow;
import static org.firstinspires.ftc.teamcode.util.PathEvents.at;
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;

public abstract class TestAuto extends NextOpMode {
    private final Robot robot;
    private final TestAutoPaths paths;

    protected TestAuto(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new TestAutoPaths(alliance);

        robot.initialize(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential(
                robot.set(Robot.State.IDLE),
                robot.flowerBar.set(FlowerBar.State.UP),
                follow(robot, paths.path1(), at(0.5, robot.flowerBar.set(FlowerBar.State.DOWN)), at(1, robot.flowerBar.set(FlowerBar.State.UP)))
        );
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Test Auto Red", preselectTeleop = "Red Teleop")
    public static class TestAutoRed extends TestAuto {
        public TestAutoRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Test Auto Blue", preselectTeleop = "Blue Teleop")
    public static class TestAutoBlue extends TestAuto {
        public TestAutoBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class TestAutoPaths {

        public final Pose start;
        private final Pose point1;

        public TestAutoPaths(Alliance alliance) {
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(23.8, 23.4, 90);
            point1 = poseFactory.of(23.8, 119.9, 270);
        }

        public Path path1() {
            return Paths.line(start, point1).linear(start, point1);
        }
    }
}
