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
        IDLE(false, 0.0, 0.0),
        REV(true, 0.0, 1.0),
        // Flywheel off; aux motor runs backwards while intaking.
        INTAKE(false, 0.0, -1.0),
        UNJAM(false, -1.0, -1.0);

        private final boolean holdsSpeed;
        private final double power;
        private final double auxPower;

        State(boolean holdsSpeed, double power, double auxPower) {
            this.holdsSpeed = holdsSpeed;
            this.power = power;
            this.auxPower = auxPower;
        }
    }

    private State state = State.IDLE;

    NextMotor shooterMotor;
    NextMotor shooterAuxMotor;

    public void initialize() {
        if (shooterAuxMotor == null) {
            shooterAuxMotor = new NextMotor(RobotController.controlHub(), Constants.Shooter.shooterAuxMotorPort);
        }
        shooterAuxMotor.setDirection(Constants.Shooter.shooterAuxMotorDirection);
        shooterAuxMotor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);
        if (shooterMotor == null) {
            shooterMotor = new NextMotor(RobotController.controlHub(), Constants.Shooter.shooterMotorPort, Rotations.of(1.0 / Constants.Shooter.ticksPerRev));
        }
        shooterMotor.setDirection(Constants.Shooter.shooterMotorDirection);
        shooterMotor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.FLOAT);
    }

    /**
     * Same controller as ShooterTune: feedforward (kS + kV * target), plus bang power while more
     * than bangZoneRpm under the target. Never negative, so over speed it just coasts down.
     */
    private double revPower(double target, double rpm) {
        if (target <= 0) return 0.0;
        double power = Constants.Shooter.kS + Constants.Shooter.kV * target;
        if (rpm < target - Constants.Shooter.bangZoneRpm) power += Constants.Shooter.bangPower;
        return Utilities.clamp(power, 0.0, 1.0);
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
        if (shooterAuxMotor != null) shooterAuxMotor.setThrottle(state.auxPower);
        if (state.holdsSpeed) {
            shooterMotor.setThrottle(revPower(targetRpm(), getRpm()));
        } else {
            shooterMotor.setThrottle(state.power);
        }
        Telemetry.log("shooter", state);
        Telemetry.log("shooter rpm", getRpm());
        // Always show the RPM a shot would use, even while idle.
        Telemetry.log("shooter target rpm", ShotCalculator.shooterRpm);
        Telemetry.log("shooter power", shooterMotor.getThrottle());
    }
}
