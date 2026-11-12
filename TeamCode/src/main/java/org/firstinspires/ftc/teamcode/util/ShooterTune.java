package org.firstinspires.ftc.teamcode.util;

import static dev.nextftc.units.Units.Rotations;
import static dev.nextftc.units.Units.RotationsPerMinute;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;

/**
 * Live tuner for the shooter velocity controller.
 * <p>
 * Dpad up/down: pick a value (setpoint, kS, kV, kA, kP, kI, kD)<br>
 * Dpad right/left: raise/lower it by the current step<br>
 * Right/left bumper: step x10 / /10<br>
 * A: spin up / stop<br>
 * B: stop and zero throttle<br>
 * X: reset all values back to Constants<br>
 * Y: setpoint to 0
 * <p>
 * Final numbers get copied into Constants.Shooter by hand.
 */
@TeleOp(name = "Shooter Tune")
public class ShooterTune extends LinearOpMode {
    private static final String[] NAMES = {"Setpoint RPM", "kS", "kV", "kA", "kP", "kI", "kD"};
    private static final double[] BASE_STEPS = {100, 0.01, 0.0001, 0.0001, 0.0001, 0.00001, 0.00001};

    @Override
    public void runOpMode() {
        NextMotor motor = new NextMotor(RobotController.controlHub(), Constants.Shooter.shooterMotorPort, Rotations.of(1.0 / Constants.Shooter.ticksPerRev));
        motor.setDirection(Constants.Shooter.shooterMotorDirection);
        motor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.FLOAT);

        double[] values = defaults();
        double[] steps = BASE_STEPS.clone();
        int selected = 0;
        boolean running = false;
        boolean applied = false;

        boolean lastUp = false, lastDown = false, lastLeft = false, lastRight = false;
        boolean lastLb = false, lastRb = false, lastA = false, lastX = false;

        waitForStart();

        while (opModeIsActive()) {
            boolean up = gamepad1.dpad_up, down = gamepad1.dpad_down;
            boolean left = gamepad1.dpad_left, right = gamepad1.dpad_right;
            boolean lb = gamepad1.left_bumper, rb = gamepad1.right_bumper;
            boolean a = gamepad1.a, x = gamepad1.x;

            if (down && !lastDown) selected = (selected + 1) % values.length;
            if (up && !lastUp) selected = (selected - 1 + values.length) % values.length;
            if (rb && !lastRb) steps[selected] *= 10;
            if (lb && !lastLb) steps[selected] /= 10;

            boolean changed = false;
            if (right && !lastRight) { values[selected] += steps[selected]; changed = true; }
            if (left && !lastLeft) { values[selected] -= steps[selected]; changed = true; }
            if (selected != 0 && values[selected] < 0) values[selected] = 0;
            if (selected == 0 && values[0] < 0) values[0] = 0;

            if (a && !lastA) running = !running;
            if (gamepad1.b) running = false;
            if (gamepad1.y) values[0] = 0;
            if (x && !lastX) {
                values = defaults();
                steps = BASE_STEPS.clone();
                changed = true;
            }

            lastUp = up; lastDown = down; lastLeft = left; lastRight = right;
            lastLb = lb; lastRb = rb; lastA = a; lastX = x;

            if (changed || !applied) {
                motor.getVelocityConstants()
                        .withS(values[1]).withV(values[2]).withA(values[3])
                        .withP(values[4]).withI(values[5]).withD(values[6]);
                applied = true;
            }

            if (running) motor.setVelocitySetpoint(RotationsPerMinute.of(values[0]));
            else motor.setThrottle(0);
            // Outside NextOpMode nothing ticks the motor's controller for us, so do it here.
            motor.update();

            double rpm = motor.getEncoderVelocity().into(RotationsPerMinute);
            double target = running ? values[0] : 0;

            telemetry.addData("State", running ? "RUNNING" : "STOPPED");
            telemetry.addData("RPM", rpm);
            telemetry.addData("Target RPM", target);
            telemetry.addData("Error", target - rpm);
            telemetry.addData("Motor power", motor.getThrottle());
            telemetry.addLine();
            for (int i = 0; i < values.length; i++) {
                telemetry.addData((i == selected ? "> " : "  ") + NAMES[i], "%.6f   (step %.6f)", values[i], steps[i]);
            }
            telemetry.addLine();
            telemetry.addLine("Dpad: select/adjust | Bumpers: step x10,/10 | A: run/stop | B: stop | X: reset | Y: setpoint 0");
            telemetry.update();
        }

        motor.setThrottle(0);
        motor.update();
    }

    private static double[] defaults() {
        return new double[]{
                3000,
                Constants.Shooter.kS, Constants.Shooter.kV, Constants.Shooter.kA,
                Constants.Shooter.kP, Constants.Shooter.kI, Constants.Shooter.kD
        };
    }
}
