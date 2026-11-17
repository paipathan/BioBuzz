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

    // Testing: driver aim trim added to the tracking angle (degrees, CCW/left positive).
    // Static so it carries over between opmodes until the robot restarts.
    public static double trimDegrees = 0;

    public Command adjustTrim(double deltaDegrees) {
        return instant(() -> trimDegrees += deltaDegrees);
    }

    public void initialize() {
        turretServo1 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort1, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection1);
        turretServo2 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort2, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection2);
        updateTurret(0);
    }

    /** Clamps a turret angle (radians, robot-relative, CCW positive) to the +/- limit. */
    public static double clampAngle(double angleRadians) {
        double limit = Math.toRadians(Constants.Turret.limitDegrees);
        return Utilities.clamp(angleRadians, -limit, limit);
    }

    /**
     * Turret angle -> servo position.
     * turret deg / ratio = servo deg; servo deg / servo range = position offset from zero.
     * e.g. +180 turret = 105.3 servo deg = 0.2965 of the throw -> 0.5 - 0.2965 = 0.2035.
     */
    public static double toPosition(double angleRadians) {
        double turretDegrees = Math.toDegrees(clampAngle(angleRadians));
        double servoDegrees = turretDegrees / Constants.Turret.servoToTurretRatio;
        double offset = servoDegrees / Constants.Turret.servoRangeDegrees;
        if (Constants.Turret.reversed) offset = -offset;
        return Utilities.clamp(Constants.Turret.zeroPosition - offset, 0.0, 1.0);
    }

    /**
     * Picks which way to reach a target near the +/-180 seam. The target from ShotCalculator is
     * wrapped to [-180, 180), so a goal sitting right behind the robot flips sign every loop; this
     * keeps the turret on its current side until the goal is clearly past the seam.
     */
    private double resolveSeam(double target) {
        double hysteresis = Math.toRadians(Constants.Turret.seamHysteresisDegrees);
        if (angle > 0 && target < -Math.PI + hysteresis) return target + 2 * Math.PI;
        if (angle < 0 && target > Math.PI - hysteresis) return target - 2 * Math.PI;
        return target;
    }

    public void updateTurret(double angleRadians) {
        angle = clampAngle(resolveSeam(angleRadians));
        if (turretServo1 == null) return;
        double position = toPosition(angle);
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
                updateTurret(ShotCalculator.turretAngle + Math.toRadians(trimDegrees));
                break;
            case LOCKED:
                updateTurret(0);
                break;
        }
        Telemetry.log("turret", state);
        Telemetry.log("turret target (deg)", Math.toDegrees(ShotCalculator.turretAngle));
        Telemetry.log("turret angle (deg)", Math.toDegrees(angle));
        Telemetry.log("turret trim (deg)", trimDegrees);
        Telemetry.log("turret servo position", toPosition(angle));
        Telemetry.log("goal distance", ShotCalculator.distance);
    }
}
