package org.firstinspires.ftc.teamcode.subsystems;

import static dev.nextftc.units.Units.Rotations;
import static dev.nextftc.units.Units.RotationsPerMinute;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Shooter implements Mechanism {
    public static final int SPIN_UP_TIMEOUT_MS = 750;
    private static final double RPM_TOLERANCE = 50.0;


    public enum State {
        IDLE(false, 0.0),
        REV(true, 0.0),
        UNJAM(false, -1.0);

        private final boolean holdsSpeed;
        private final double power;

        State(boolean holdsSpeed, double power) {
            this.holdsSpeed = holdsSpeed;
            this.power = power;
        }
    }

    private State state = State.IDLE;

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

    public double getRpm() {
        if (shooterMotor == null) return 0.0;
        return shooterMotor.getEncoderVelocity().into(RotationsPerMinute);
    }

    public double targetRpm() {
        return state.holdsSpeed ? ShotCalculator.shooterRpm : 0.0;
    }

    public boolean atSpeed() {
        if (shooterMotor == null) return true; // not installed: don't stall the feed waiting on spin-up
        return Utilities.inTolerance(getRpm(), targetRpm(), RPM_TOLERANCE);
    }

    @Override
    public void periodic() {
        if (shooterMotor == null) return;
        if (state.holdsSpeed) {
            shooterMotor.setVelocitySetpoint(RotationsPerMinute.of(targetRpm()));
        } else {
            shooterMotor.setThrottle(state.power);
        }
        Telemetry.log("shooter", state);
        Telemetry.log("shooter rpm", getRpm());
        Telemetry.log("shooter target rpm", targetRpm());
        Telemetry.log("shooter power", shooterMotor.getThrottle());
    }
}
