package org.firstinspires.ftc.teamcode.subsystems;

import static dev.nextftc.units.Units.Rotations;
import static dev.nextftc.units.Units.RotationsPerMinute;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.hardware.actuators.NextServo;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Shooter implements Mechanism {
    private State state = State.IDLE;
    public enum State {
        IDLE,
        REV,
        UNJAM
    }

    NextMotor shooterMotor;

    public void initialize() {
        if (shooterMotor == null) {
            shooterMotor = new NextMotor(RobotController.controlHub(), Constants.Shooter.shooterMotorPort, Rotations.of(1.0 / Constants.Shooter.ticksPerRev));
        }
        shooterMotor.setDirection(Constants.Shooter.shooterMotorDirection);
        shooterMotor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.FLOAT);
        shooterMotor.getVelocityConstants()
                .withS(Constants.Shooter.kS).withV(Constants.Shooter.kV).withA(Constants.Shooter.kA)
                .withP(Constants.Shooter.kP).withI(Constants.Shooter.kI).withD(Constants.Shooter.kD);
    }

    public Command set(State state) {
        return instant(() -> this.state = state);
    }

    public State getState() {
        return state;
    }

    private double targetRpm() {
        return state == State.REV ? 4000.0 : 0.0;
    }

    public double getRpm() {
        return shooterMotor.getEncoderVelocity().into(RotationsPerMinute);
    }

    public boolean atSpeed() {
        return Utilities.inTolerance(getRpm(), targetRpm(), 50.0);
    }

    @Override
    public void periodic() {
        if (shooterMotor == null) return;
        switch (state) {
            case IDLE:
                shooterMotor.setThrottle(0.0);
                break;
            case REV:
                shooterMotor.setVelocitySetpoint(RotationsPerMinute.of(targetRpm()));
                break;
            case UNJAM:
                shooterMotor.setThrottle(-1.0);
                break;
        }
        Telemetry.log("shooter", state);
        Telemetry.log("shooter rpm", getRpm());
        Telemetry.log("shooter target rpm", targetRpm());
        Telemetry.log("shooter power", shooterMotor.getThrottle());
    }
}
