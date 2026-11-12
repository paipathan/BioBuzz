package org.firstinspires.ftc.teamcode.teleop;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.robot.opmode.BulkReadHook;
import dev.nextftc.robot.opmode.NextOpMode;
import dev.nextftc.robot.opmode.NextTeleop;

public abstract class Tele extends NextOpMode {
    private final Robot robot;

    protected Tele(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;

        robot.initialize(Constants.Drivetrain.startPose, alliance);
        robot.configureBindings(gamepad1);
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { robot.set(Robot.State.IDLE).schedule(); }

    @NextTeleop(name = "🥩 Red Teleop (W meats)")
    public static class Red extends Tele {
        public Red(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextTeleop(name = "🥶 Blue Teleop (didy teleop)")
    public static class Blue extends Tele {
        public Blue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }
}


// Panels: http://192.168.43.1:8001