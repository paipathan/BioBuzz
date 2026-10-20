package org.firstinspires.ftc.teamcode.teleop;

import com.bylazar.telemetry.PanelsTelemetry;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;

import dev.nextftc.robot.Telemetry;
import dev.nextftc.robot.opmode.NextOpMode;

public abstract class NextTele extends NextOpMode {
    private final Robot robot;
    private final Alliance alliance;

    protected NextTele(Robot robot, Alliance alliance) {
        super(robot);
        this.robot = robot;
        this.alliance = alliance;

        Telemetry.addBackend(PanelsTelemetry.INSTANCE.getFtcTelemetry());
        robot.drivetrain.initialize(Constants.Drivetrain.startPose);
        robot.configureBindings(gamepad1, alliance);
    }

    @Override
    public void disabledPeriodic() { robot.drivetrain.periodic(); }

    @Override
    public void start() { robot.set(Robot.State.IDLE).schedule(); }

    @Override
    public void periodic() { ShotCalculator.update(robot.drivetrain.getFollower(), alliance); }
}
