package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Turret implements Mechanism {
    private State state = State.TRACKING;
    public enum State {
        TRACKING,
        LOCKED
    }

    NextServo turretServo1;
    NextServo turretServo2;

    private double angle = 0;

    public void initialize() {
        turretServo1 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort1, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection1);
        turretServo2 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort2, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection2);
        updateTurret(0);
    }

    public static double toPosition(double angleRadians) {
        double max = Constants.Turret.rangeDegrees / 2;
        double degrees = Utilities.clamp(Math.toDegrees(angleRadians), -max, max);
        return 0.5 - degrees / Constants.Turret.rangeDegrees;
    }

    public void updateTurret(double angleRadians) {
        angle = angleRadians;
        if (turretServo1 == null) return;
        double position = toPosition(angleRadians);
        turretServo1.setPosition(position);
        turretServo2.setPosition(position);
    }

    public Command set(State state) {
        return instant(() -> this.state = state);
    }

    public Command toggleLock() {
        return instant(() -> state = state == State.TRACKING ? State.LOCKED : State.TRACKING);
    }

    public State getState() {
        return state;
    }

    @Override
    public void periodic() {
        if (turretServo1 == null) return;
        switch (state) {
            case TRACKING:
                updateTurret(ShotCalculator.turretAngle);
                break;
            case LOCKED:
                updateTurret(0);
                break;
        }
        Telemetry.log("turret", state);
        Telemetry.log("turret angle (deg)", Math.toDegrees(angle));
        Telemetry.log("goal distance", ShotCalculator.distance);
    }
}
