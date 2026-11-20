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

public abstract class Lala extends NextOpMode {
    private final Robot robot;
    private final LalaPaths paths;

    protected Lala(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new LalaPaths(alliance);

        robot.initialize(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential();
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

    @NextAutonomous(name = "Lala Red", preselectTeleop = "Red Teleop")
    public static class LalaRed extends Lala {
        public LalaRed(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextAutonomous(name = "Lala Blue", preselectTeleop = "Blue Teleop")
    public static class LalaBlue extends Lala {
        public LalaBlue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }

    public static class LalaPaths {

        public final Pose start;

        public LalaPaths(Alliance alliance) {
            PoseFactory poseFactory = Utilities.poseFactory(alliance);

            start = poseFactory.of(8.5, 58.5, 0);
        }
    }
}
