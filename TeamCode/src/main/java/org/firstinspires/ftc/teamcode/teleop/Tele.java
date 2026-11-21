package org.firstinspires.ftc.teamcode.teleop;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;
import dev.nextftc.robot.Telemetry;
import dev.nextftc.robot.opmode.BulkReadHook;
import dev.nextftc.robot.opmode.NextOpMode;
import dev.nextftc.robot.opmode.NextTeleop;

public abstract class Tele extends NextOpMode {
    // Autos preselect teleop by exact name, so they reference these instead of retyping them.
    public static final String RED = "🥩 Red Teleop (W meats)";
    public static final String BLUE = "🥶 Blue Teleop (didy teleop)";

    private final Robot robot;
    private final boolean poseFromAuto;

    protected Tele(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;

        poseFromAuto = robot.initializeTeleop(alliance);
        robot.configureBindings(gamepad1);
    }

    @Override
    public void disabledPeriodic() {
        Telemetry.log("start pose", poseFromAuto ? "handed off from auto" : "default (no auto ran), press A at the wall");
        robot.disabledPeriodic();
    }

    @Override
    public void start() { robot.set(Robot.State.IDLE).schedule(); }

    @NextTeleop(name = RED)
    public static class Red extends Tele {
        public Red(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextTeleop(name = BLUE)
    public static class Blue extends Tele {
        public Blue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }
}


// Panels: http://192.168.43.1:8001